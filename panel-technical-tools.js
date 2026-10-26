
/*
 * MiEje Market — herramientas adicionales del propietario técnico.
 * Se conecta con la función Supabase technical-business-management.
 * No sustituye ni elimina las funciones existentes del panel.
 */
(() => {
  'use strict';

  document.addEventListener('DOMContentLoaded', iniciar);

  async function iniciar() {
    if (document.body.dataset.panel !== 'technical') return;

    const db = window.supabase?.createClient(
      window.MIEJE_SUPABASE_URL,
      window.MIEJE_SUPABASE_PUBLISHABLE_KEY
    );

    if (!db) {
      console.error('MiEje Market: revisa supabase-config.js.');
      return;
    }

    const { data: auth, error: authError } = await db.auth.getUser();

    if (authError || !auth.user) {
      window.location.replace('login.html');
      return;
    }

    const { data: profile, error: profileError } = await db
      .from('profiles')
      .select('id, platform_role')
      .eq('id', auth.user.id)
      .single();

    if (profileError || profile?.platform_role !== 'platform_owner') {
      console.error('Acceso denegado: se requiere el propietario técnico.');
      return;
    }

    insertarHerramientas();
    document.querySelector('#mtActualizar')
      ?.addEventListener('click', cargarNegocios);
    document.querySelector('#mtNegocio')
      ?.addEventListener('change', cargarUsuarios);
    document.querySelector('#mtEliminarUsuario')
      ?.addEventListener('submit', eliminarUsuario);
    document.querySelector('#mtDepurar')
      ?.addEventListener('submit', depurarRegistros);

    await cargarNegocios();

    async function llamarFuncion(datos) {
      const { data: sesion, error } = await db.auth.getSession();

      if (error || !sesion.session?.access_token) {
        throw new Error('La sesión expiró. Inicia sesión de nuevo.');
      }

      const respuesta = await fetch(
        `${window.MIEJE_SUPABASE_URL}/functions/v1/technical-business-management`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': window.MIEJE_SUPABASE_PUBLISHABLE_KEY,
            'Authorization': `Bearer ${sesion.session.access_token}`
          },
          body: JSON.stringify(datos)
        }
      );

      const resultado = await respuesta.json().catch(() => ({}));

      if (!respuesta.ok) {
        throw new Error(
          resultado.error || `La operación falló (${respuesta.status}).`
        );
      }

      return resultado;
    }

    async function cargarNegocios() {
      const selectNegocio = document.querySelector('#mtNegocio');
      const selectDepuracion = document.querySelector(
        '#mtDepurar [name="business_id"]'
      );
      const estado = document.querySelector('#mtEstado');

      estado.textContent = 'Cargando negocios…';

      const { data, error } = await db
        .from('businesses')
        .select('id,name,is_active')
        .order('name');

      if (error) {
        estado.textContent = `Error al consultar negocios: ${error.message}`;
        return;
      }

      const negocios = data || [];

      selectNegocio.innerHTML =
        '<option value="">Selecciona un negocio</option>';

      selectDepuracion.innerHTML =
        '<option value="">Todos los negocios / registros globales</option>';

      for (const negocio of negocios) {
        const etiqueta =
          negocio.name + (negocio.is_active ? '' : ' (suspendido)');

        selectNegocio.add(new Option(etiqueta, negocio.id));
        selectDepuracion.add(new Option(etiqueta, negocio.id));
      }

      estado.textContent = `${negocios.length} negocios encontrados.`;
    }

    async function cargarUsuarios() {
      const negocioId = document.querySelector('#mtNegocio').value;
      const select = document.querySelector('#mtUsuario');

      select.innerHTML = '<option value="">Cargando usuarios…</option>';

      if (!negocioId) {
        select.innerHTML = '<option value="">Selecciona un negocio primero</option>';
        return;
      }

      const { data, error } = await db
        .from('business_members')
        .select('user_id,role,profiles(display_name)')
        .eq('business_id', negocioId)
        .order('created_at', { ascending: false });

      if (error) {
        select.innerHTML = '<option value="">Error al cargar usuarios</option>';
        mostrar('mtUsuarioMensaje', error.message, true);
        return;
      }

      select.innerHTML = '<option value="">Selecciona una cuenta</option>';

      for (const usuario of data || []) {
        const nombre =
          usuario.profiles?.display_name || usuario.user_id;

        const rol = usuario.role === 'business_admin'
          ? 'Administrador'
          : 'Empleado';

        select.add(
          new Option(`${nombre} · ${rol} · ${usuario.user_id}`, usuario.user_id)
        );
      }
    }

    async function eliminarUsuario(evento) {
      evento.preventDefault();

      const negocioId = document.querySelector('#mtNegocio').value;
      const usuarioId = document.querySelector('#mtUsuario').value;

      if (!negocioId || !usuarioId) {
        mostrar('mtUsuarioMensaje', 'Selecciona un negocio y una cuenta.', true);
        return;
      }

      const confirmacion = prompt(
        `Esta operación es permanente.\nEscribe exactamente el ID del usuario:\n${usuarioId}`
      );

      if (confirmacion !== usuarioId) {
        mostrar('mtUsuarioMensaje', 'Confirmación incorrecta. No se realizó ningún cambio.', true);
        return;
      }

      if (!confirm('¿Confirmas eliminar la asignación de este usuario al negocio?')) {
        return;
      }

      const boton = evento.currentTarget.querySelector('[type="submit"]');
      boton.disabled = true;

      try {
        const resultado = await llamarFuncion({
          action: 'delete_member',
          business_id: negocioId,
          user_id: usuarioId,
          confirm_text: confirmacion
        });

        mostrar(
          'mtUsuarioMensaje',
          resultado.message || 'La operación fue procesada por el servidor.',
          false
        );

        await cargarUsuarios();
      } catch (error) {
        mostrar('mtUsuarioMensaje', error.message, true);
      } finally {
        boton.disabled = false;
      }
    }

    async function depurarRegistros(evento) {
      evento.preventDefault();

      const form = evento.currentTarget;
      const datos = Object.fromEntries(new FormData(form).entries());

      if (datos.confirm_text !== 'ELIMINAR') {
        mostrar('mtDepurarMensaje', 'Escribe exactamente ELIMINAR.', true);
        return;
      }

      const nombres = {
        payroll_records: 'nómina y honorarios',
        access_block_requests: 'solicitudes de bloqueo',
        access_events: 'historial de accesos',
        audit_events: 'auditoría global',
        platform_financial_records: 'registros financieros'
      };

      const ambito = datos.business_id
        ? 'del negocio seleccionado'
        : 'de todos los negocios o de la plataforma';

      const aviso =
        `Vas a eliminar ${nombres[datos.table_name]} ${ambito}.\n\n` +
        'Esta operación es permanente. Si borras auditoría o accesos, ' +
        'perderás el historial correspondiente.\n\n¿Deseas continuar?';

      if (!confirm(aviso)) return;

      const boton = form.querySelector('[type="submit"]');
      boton.disabled = true;

      try {
        const resultado = await llamarFuncion({
          action: 'purge_records',
          table_name: datos.table_name,
          business_id: datos.business_id,
          confirm_text: datos.confirm_text
        });

        mostrar(
          'mtDepurarMensaje',
          `${resultado.message || 'Solicitud procesada.'} ` +
          `Registros eliminados: ${resultado.deleted_count ?? 'No informado'}.`,
          false
        );

        form.elements.confirm_text.value = '';
      } catch (error) {
        mostrar('mtDepurarMensaje', error.message, true);
      } finally {
        boton.disabled = false;
      }
    }

    function mostrar(id, texto, error = false) {
      const elemento = document.getElementById(id);
      if (!elemento) return;

      elemento.textContent = texto;
      elemento.style.color = error ? '#b42318' : '';
    }
  }

  function insertarHerramientas() {
    if (document.querySelector('#mtHerramientas')) return;

    const contenido = document.querySelector('main') ||
      document.querySelector('.main') ||
      document.body;

    const seccion = document.createElement('section');
    seccion.id = 'mtHerramientas';
    seccion.style.cssText =
      'max-width:1000px;margin:28px auto;padding:24px;' +
      'border:1px solid #d5dbe3;border-radius:12px;';

    seccion.innerHTML = `
      <h2>Administración técnica avanzada</h2>
      <p>
        Estas herramientas están destinadas al propietario técnico.
        Las operaciones permanentes deben usarse con precaución.
      </p>

      <button id="mtActualizar" type="button">
        Actualizar negocios
      </button>

      <p id="mtEstado" aria-live="polite">Preparando herramientas…</p>

      <hr>

      <h3>Eliminar asignación de usuario</h3>
      <form id="mtEliminarUsuario">
        <label for="mtNegocio">Negocio</label><br>
        <select id="mtNegocio" required style="width:100%;padding:10px">
          <option value="">Selecciona un negocio</option>
        </select>

        <br><br>

        <label for="mtUsuario">Usuario asignado</label><br>
        <select id="mtUsuario" required style="width:100%;padding:10px">
          <option value="">Selecciona primero un negocio</option>
        </select>

        <br><br>

        <button type="submit">Eliminar asignación</button>
        <p id="mtUsuarioMensaje" aria-live="polite"></p>
      </form>

      <hr>

      <h3>Depuración permanente de registros</h3>
      <p>
        Advertencia: eliminar accesos o auditoría puede borrar evidencia
        histórica. No uses esta función si necesitas conservarla.
      </p>

      <form id="mtDepurar">
        <label for="mtTabla">Tipo de registro</label><br>
        <select id="mtTabla" name="table_name" required
          style="width:100%;padding:10px">
          <option value="payroll_records">Nómina y honorarios</option>
          <option value="access_block_requests">Solicitudes de bloqueo</option>
          <option value="access_events">Historial de accesos</option>
          <option value="audit_events">Auditoría global</option>
          <option value="platform_financial_records">Registros financieros</option>
        </select>

        <br><br>

        <label for="mtAmbito">Ámbito</label><br>
        <select id="mtAmbito" name="business_id"
          style="width:100%;padding:10px">
          <option value="">Todos los negocios / registros globales</option>
        </select>

        <br><br>

        <label for="mtConfirmacion">
          Para confirmar, escribe ELIMINAR
        </label><br>
        <input id="mtConfirmacion" name="confirm_text" required
          autocomplete="off" style="width:100%;padding:10px">

        <br><br>

        <button type="submit">Eliminar registros seleccionados</button>
        <p id="mtDepurarMensaje" aria-live="polite"></p>
      </form>
    `;

    contenido.appendChild(seccion);
  }
})();
