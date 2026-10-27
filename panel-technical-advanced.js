
(() => {
  'use strict';

  document.addEventListener('DOMContentLoaded', iniciar);

  async function iniciar() {
    if (document.body.dataset.panel !== 'technical') return;

    const url = window.MIEJE_SUPABASE_URL;
    const key = window.MIEJE_SUPABASE_PUBLISHABLE_KEY;
    const supabase = window.supabase;

    if (!url || !key || !supabase?.createClient) {
      console.error(
        'MiEje Market: revisa supabase-config.js y la carga de Supabase.'
      );
      return;
    }

    const db = supabase.createClient(url, key);
    const { data: auth } = await db.auth.getUser();

    if (!auth?.user) {
      window.location.replace('login.html');
      return;
    }

    const { data: perfil, error: perfilError } = await db
      .from('profiles')
      .select('platform_role')
      .eq('id', auth.user.id)
      .single();

    if (perfilError || perfil?.platform_role !== 'platform_owner') {
      console.error('Acceso denegado: se requiere el propietario técnico.');
      return;
    }

    crearInterfaz();
    document.querySelector('#taRecargar')
      .addEventListener('click', cargarDatos);
    document.querySelector('#taSuspender')
      .addEventListener('submit', cambiarEstadoNegocio);
    document.querySelector('#taBloquear')
      .addEventListener('submit', cambiarEstadoUsuario);
    document.querySelector('#taEliminarNegocio')
      .addEventListener('submit', eliminarNegocio);

    await cargarDatos();

    async function llamarServidor(payload) {
      const { data: sesion, error: sesionError } =
        await db.auth.getSession();

      if (sesionError || !sesion.session?.access_token) {
        throw new Error('La sesión expiró. Inicia sesión nuevamente.');
      }

      const respuesta = await fetch(
        `${url}/functions/v1/technical-business-management`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': key,
            'Authorization': `Bearer ${sesion.session.access_token}`
          },
          body: JSON.stringify(payload)
        }
      );

      const resultado = await respuesta.json().catch(() => ({}));

      if (!respuesta.ok) {
        throw new Error(
          resultado.error || `Error del servidor: ${respuesta.status}`
        );
      }

      return resultado;
    }

    async function cargarDatos() {
      const estado = document.querySelector('#taEstado');
      estado.textContent = 'Consultando negocios y solicitudes…';

      const { data: negocios, error } = await db
        .from('businesses')
        .select('id,name,is_active')
        .order('name');

      if (error) {
        estado.textContent = `No se pudieron cargar los negocios: ${error.message}`;
        return;
      }

      const opciones = [
        new Option('Selecciona un negocio', ''),
        ...(negocios || []).map(b =>
          new Option(
            `${b.name}${b.is_active ? '' : ' (suspendido)'}`,
            b.id
          )
        )
      ];

      for (const id of ['taNegocioEstado', 'taNegocioUsuario', 'taNegocioEliminar']) {
        const select = document.getElementById(id);
        const anterior = select.value;
        select.replaceChildren(...opciones.map(o => o.cloneNode(true)));
        if ([...select.options].some(o => o.value === anterior)) {
          select.value = anterior;
        }
      }

      const { data: solicitudes, error: errorSolicitudes } = await db
        .from('access_block_requests')
        .select('id,business_id,target_user_id,reason,status,created_at')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      const contenedorSolicitudes = document.querySelector('#taSolicitudes');
      contenedorSolicitudes.replaceChildren();

      if (errorSolicitudes) {
        contenedorSolicitudes.textContent =
          `No se pudieron consultar las solicitudes: ${errorSolicitudes.message}`;
      } else if (!solicitudes?.length) {
        contenedorSolicitudes.textContent = 'No hay solicitudes pendientes.';
      } else {
        for (const solicitud of solicitudes) {
          const tarjeta = document.createElement('article');
          tarjeta.style.cssText =
            'border:1px solid #d5dbe3;border-radius:8px;padding:14px;margin:12px 0';

          const titulo = document.createElement('strong');
          titulo.textContent = `Solicitud para la cuenta ${solicitud.target_user_id}`;

          const detalle = document.createElement('p');
          detalle.textContent =
            `Negocio: ${solicitud.business_id} · Motivo: ${solicitud.reason}`;

          const nota = document.createElement('input');
          nota.placeholder = 'Nota técnica opcional';
          nota.maxLength = 1500;
          nota.style.cssText = 'width:100%;padding:9px';

          const aprobar = document.createElement('button');
          aprobar.type = 'button';
          aprobar.textContent = 'Aprobar y bloquear';
          aprobar.addEventListener('click', () =>
            resolverSolicitud(solicitud.id, 'approved', nota.value, aprobar)
          );

          const rechazar = document.createElement('button');
          rechazar.type = 'button';
          rechazar.textContent = 'Rechazar solicitud';
          rechazar.style.marginLeft = '8px';
          rechazar.addEventListener('click', () =>
            resolverSolicitud(solicitud.id, 'rejected', nota.value, rechazar)
          );

          tarjeta.append(titulo, detalle, nota, document.createElement('br'),
            aprobar, rechazar);
          contenedorSolicitudes.appendChild(tarjeta);
        }
      }

      estado.textContent =
        `${negocios?.length || 0} negocios encontrados. ` +
        `${errorSolicitudes ? 'No se pudieron consultar las solicitudes.' :
          `${solicitudes?.length || 0} solicitudes pendientes.`}`;
    }

    async function cambiarEstadoNegocio(evento) {
      evento.preventDefault();

      const form = evento.currentTarget;
      const businessId = form.elements.business_id.value;
      const isActive = form.elements.is_active.value === 'true';
      const reason = form.elements.reason.value.trim();
      const publicMessage = form.elements.public_message.value.trim();

      if (!businessId) {
        mensaje('taEstadoMensaje', 'Selecciona un negocio.', true);
        return;
      }

      if (!isActive && reason.length < 5) {
        mensaje('taEstadoMensaje', 'Escribe un motivo de al menos 5 caracteres.', true);
        return;
      }

      const confirmacion = isActive
        ? '¿Confirmas reactivar este negocio?'
        : '¿Confirmas suspender el negocio y ocultar temporalmente su disponibilidad pública?';

      if (!confirm(confirmacion)) return;

      await ejecutar(form, 'taEstadoMensaje', async () => {
        const resultado = await llamarServidor({
          action: 'set_business_status',
          business_id: businessId,
          is_active: isActive,
          reason,
          public_message: publicMessage
        });

        form.reset();
        await cargarDatos();
        return resultado.message;
      });
    }

    async function cambiarEstadoUsuario(evento) {
      evento.preventDefault();

      const form = evento.currentTarget;
      const businessId = form.elements.business_id.value;
      const userId = form.elements.user_id.value;
      const isBlocked = form.elements.is_blocked.value === 'true';
      const reason = form.elements.reason.value.trim();

      if (!businessId || !userId) {
        mensaje('taUsuarioMensaje', 'Selecciona el negocio y el usuario.', true);
        return;
      }

      if (isBlocked && reason.length < 5) {
        mensaje('taUsuarioMensaje', 'Escribe un motivo de al menos 5 caracteres.', true);
        return;
      }

      if (!confirm(isBlocked
        ? '¿Confirmas bloquear el acceso de esta cuenta a este negocio?'
        : '¿Confirmas reactivar el acceso de esta cuenta?')) return;

      await ejecutar(form, 'taUsuarioMensaje', async () => {
        const resultado = await llamarServidor({
          action: 'set_member_status',
          business_id: businessId,
          user_id: userId,
          is_blocked: isBlocked,
          reason
        });

        return resultado.message;
      });
    }

    async function eliminarNegocio(evento) {
      evento.preventDefault();

      const form = evento.currentTarget;
      const businessId = form.elements.business_id.value;
      const confirmName = form.elements.confirm_name.value.trim();

      if (!businessId || !confirmName) {
        mensaje('taEliminarMensaje', 'Selecciona el negocio y escribe su nombre exacto.', true);
        return;
      }

      if (!confirm(
        'ATENCIÓN: la eliminación es permanente y puede afectar datos asociados. ' +
        'Comprueba que elegiste el negocio correcto. ¿Deseas continuar?'
      )) return;

      await ejecutar(form, 'taEliminarMensaje', async () => {
        const resultado = await llamarServidor({
          action: 'delete_business',
          business_id: businessId,
          confirm_name: confirmName
        });

        form.reset();
        await cargarDatos();
        return resultado.message;
      });
    }

    async function resolverSolicitud(id, decision, note, boton) {
      if (!confirm(
        decision === 'approved'
          ? '¿Aprobar la solicitud y bloquear la cuenta indicada?'
          : '¿Rechazar esta solicitud?'
      )) return;

      boton.disabled = true;

      try {
        const resultado = await llamarServidor({
          action: 'resolve_block_request',
          request_id: id,
          decision,
          technician_note: note
        });

        mensaje('taSolicitudesMensaje', resultado.message, false);
        await cargarDatos();
      } catch (error) {
        mensaje('taSolicitudesMensaje', error.message, true);
      } finally {
        boton.disabled = false;
      }
    }

    async function ejecutar(form, idMensaje, trabajo) {
      const boton = form.querySelector('[type="submit"]');
      if (boton) boton.disabled = true;

      try {
        const resultado = await trabajo();
        mensaje(idMensaje, resultado || 'Operación completada.', false);
      } catch (error) {
        mensaje(idMensaje, error.message || 'Ocurrió un error.', true);
      } finally {
        if (boton) boton.disabled = false;
      }
    }

    function mensaje(id, texto, error) {
      const elemento = document.getElementById(id);
      if (!elemento) return;
      elemento.textContent = texto;
      elemento.style.color = error ? '#b42318' : '#167647';
    }
  }

  function crearInterfaz() {
    if (document.getElementById('taHerramientasAvanzadas')) return;

    const contenedor = document.createElement('section');
    contenedor.id = 'taHerramientasAvanzadas';
    contenedor.style.cssText =
      'max-width:1100px;margin:28px auto;padding:22px;' +
      'border:1px solid #d5dbe3;border-radius:12px';

    contenedor.innerHTML = `
      <h2>Herramientas técnicas avanzadas</h2>
      <p>Estas acciones se validan en el servidor y quedan sujetas a permisos técnicos.</p>
      <button id="taRecargar" type="button">Actualizar datos</button>
      <p id="taEstado" aria-live="polite">Preparando…</p>

      <hr>
      <h3>Suspender o reactivar un negocio</h3>
      <form id="taSuspender">
        <label>Negocio</label>
        <select id="taNegocioEstado" name="business_id" required style="width:100%;padding:10px">
          <option value="">Cargando…</option>
        </select>
        <p><label>Acción</label></p>
        <select name="is_active" required style="width:100%;padding:10px">
          <option value="false">Suspender negocio</option>
          <option value="true">Reactivar negocio</option>
        </select>
        <p><label>Motivo interno de suspensión (obligatorio al suspender)</label></p>
        <textarea name="reason" rows="3" style="width:100%;padding:10px"></textarea>
        <p><label>Mensaje visible para los clientes (opcional)</label></p>
        <textarea name="public_message" rows="2" style="width:100%;padding:10px"></textarea>
        <p><button type="submit">Aplicar cambio de estado</button></p>
        <p id="taEstadoMensaje" aria-live="polite"></p>
      </form>

      <hr>
      <h3>Bloquear o reactivar una cuenta en un negocio</h3>
      <form id="taBloquear">
        <label>Negocio</label>
        <select id="taNegocioUsuario" name="business_id" required style="width:100%;padding:10px">
          <option value="">Cargando…</option>
        </select>
        <p><label>ID de usuario asignado al negocio</label></p>
        <input name="user_id" required placeholder="Pega el ID de usuario" style="width:100%;padding:10px">
        <p><label>Acción</label></p>
        <select name="is_blocked" required style="width:100%;padding:10px">
          <option value="true">Bloquear cuenta en este negocio</option>
          <option value="false">Reactivar cuenta en este negocio</option>
        </select>
        <p><label>Motivo del bloqueo (obligatorio al bloquear)</label></p>
        <textarea name="reason" rows="3" style="width:100%;padding:10px"></textarea>
        <p><button type="submit">Aplicar cambio de acceso</button></p>
        <p id="taUsuarioMensaje" aria-live="polite"></p>
      </form>

      <hr>
      <h3>Eliminar un negocio permanentemente</h3>
      <p><strong>Precaución:</strong> esta acción no se puede deshacer. Confirma únicamente si estás seguro.</p>
      <form id="taEliminarNegocio">
        <label>Negocio</label>
        <select id="taNegocioEliminar" name="business_id" required style="width:100%;padding:10px">
          <option value="">Cargando…</option>
        </select>
        <p><label>Escribe exactamente el nombre del negocio seleccionado</label></p>
        <input name="confirm_name" required autocomplete="off" style="width:100%;padding:10px">
        <p><button type="submit">Eliminar negocio permanentemente</button></p>
        <p id="taEliminarMensaje" aria-live="polite"></p>
      </form>

      <hr>
      <h3>Solicitudes de bloqueo pendientes</h3>
      <p>Revisa el motivo antes de aprobar o rechazar una solicitud.</p>
      <div id="taSolicitudes"></div>
      <p id="taSolicitudesMensaje" aria-live="polite"></p>
    `;

    const destino = document.querySelector('main') ||
      document.querySelector('.main') ||
      document.body;

    destino.appendChild(contenedor);
  }
})();
