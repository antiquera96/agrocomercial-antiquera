(function () {
  'use strict';

  const app = document.getElementById('app');

  // ============================================================
  // UTILIDADES
  // ============================================================
  const fmtCLP = n => '$' + (parseInt(n, 10) || 0).toLocaleString('es-CL');

  const escapeHtml = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);

  const toMs = (v) => (DB && DB.toMs) ? DB.toMs(v) : (typeof v === 'number' ? v : 0);

  const fmtDate = ts => {
    const ms = toMs(ts);
    if (!ms) return '';
    const d = new Date(ms);
    return d.toLocaleDateString('es-CL') + ' ' + d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
  };

  const fmtDateOnly = s => {
    if (!s) return '';
    const parts = String(s).split('-');
    if (parts.length !== 3) return s;
    return parts[2] + '/' + parts[1] + '/' + parts[0];
  };

  function toast(msg, type) {
    const t = document.createElement('div');
    t.className = 'toast toast-' + (type || 'success');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 300);
    }, 2500);
  }

  function humanAuthError(err) {
    const code = err && err.code ? err.code : '';
    if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'Credenciales incorrectas';
    if (code.includes('email-already-in-use')) return 'Ese correo ya está registrado';
    if (code.includes('weak-password')) return 'Contraseña muy corta (mínimo 6 caracteres)';
    if (code.includes('invalid-email')) return 'Correo inválido';
    if (code.includes('too-many-requests')) return 'Demasiados intentos. Espera un momento.';
    if (code.includes('network')) return 'Sin conexión a internet';
    return (err && err.message) || 'Error de autenticación';
  }

  // Runner async para botones: deshabilita y muestra spinner, toast en error.
  async function runAsync(btn, fn, labelLoading) {
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="inline-spinner"></span> ${labelLoading || 'Guardando…'}`;
    try {
      await fn();
    } catch (e) {
      console.error(e);
      toast(humanAuthError(e) || 'Error', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }

  function modal(title, bodyHtml, onSubmit, submitText) {
    const m = document.createElement('div');
    m.className = 'modal-overlay';
    m.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3>${escapeHtml(title)}</h3>
          <button class="modal-close" type="button">×</button>
        </div>
        <form class="modal-body">
          ${bodyHtml}
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary btn-cancel">Cancelar</button>
            <button type="submit" class="btn btn-primary">${escapeHtml(submitText || 'Guardar')}</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(m);
    const close = () => m.remove();
    m.querySelector('.modal-close').onclick = close;
    m.querySelector('.btn-cancel').onclick = close;
    m.onclick = (e) => { if (e.target === m) close(); };
    const form = m.querySelector('form');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const data = {};
      form.querySelectorAll('[name]').forEach(el => {
        if (el.type !== 'file') data[el.name] = el.value;
      });
      const submitBtn = form.querySelector('button[type=submit]');
      const original = submitBtn.innerHTML;
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<span class="inline-spinner"></span> Guardando…`;
      try {
        const result = await onSubmit(data, form, close);
        if (result === false) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = original;
          return;
        }
        close();
      } catch (err) {
        console.error(err);
        toast(humanAuthError(err) || 'Error', 'error');
        submitBtn.disabled = false;
        submitBtn.innerHTML = original;
      }
    };
    setTimeout(() => {
      const first = form.querySelector('input:not([type=file]), textarea, select');
      if (first) first.focus();
    }, 50);
    return m;
  }

  // ============================================================
  // ROUTING
  // ============================================================
  const IS_STAFF_PORTAL = !!window.AA_STAFF_PORTAL || /\/admin(\/|$)/i.test(window.location.pathname);
  const LOGO_PATH = IS_STAFF_PORTAL ? '../assets/logo.png' : 'assets/logo.png';

  let authMode = 'login';
  let adminSection = 'productos';
  let vendedorSection = 'productos';
  let clienteSection = 'productos';
  let papeleraTab = 'orders';
  let cart = [];

  async function logout() {
    try { await DB.logout(); } catch (e) { console.error(e); }
    cart = [];
    adminSection = 'productos';
    vendedorSection = 'productos';
    clienteSection = 'productos';
    papeleraTab = 'orders';
    // render se disparará automáticamente por onAuthStateChanged
  }

  function render() {
    const session = DB.getSession();
    if (!session) { renderAuth(); return; }
    if (IS_STAFF_PORTAL && session.role === 'cliente') { renderWrongPortal('cliente'); return; }
    if (!IS_STAFF_PORTAL && session.role !== 'cliente') { renderWrongPortal('staff'); return; }
    if (session.role === 'admin') renderAdmin();
    else if (session.role === 'vendedor') renderVendedor();
    else if (session.role === 'cliente') renderCliente();
  }

  function renderWrongPortal(kind) {
    const msg = kind === 'cliente'
      ? 'Tu cuenta es de cliente. Usa el sitio público, no el acceso interno.'
      : 'Tu cuenta es de staff. Usa el acceso interno en /admin.';
    app.innerHTML = `
      <div class="auth-wrapper">
        <div class="auth-card">
          <div class="auth-brand">
            <div class="auth-logo"><img src="${LOGO_PATH}" alt="Logo"></div>
            <h1>Agrocomercial Antiquera</h1>
          </div>
          <p class="auth-info">${escapeHtml(msg)}</p>
          <button class="btn btn-primary btn-block" id="wrong-portal-logout">Cerrar sesión</button>
        </div>
      </div>
    `;
    document.getElementById('wrong-portal-logout').onclick = logout;
  }

  // ============================================================
  // AUTH
  // ============================================================
  function renderAuth() {
    if (IS_STAFF_PORTAL) {
      app.innerHTML = `
        <div class="auth-wrapper">
          <div class="auth-card">
            <div class="auth-brand">
              <div class="auth-logo"><img src="${LOGO_PATH}" alt="Logo"></div>
              <h1>Acceso interno</h1>
              <p>Administradores y vendedores</p>
            </div>
            <div id="auth-content"></div>
            <p class="auth-back"><a href="../">← Volver al sitio público</a></p>
          </div>
        </div>
      `;
      renderLogin();
      return;
    }

    app.innerHTML = `
      <div class="auth-wrapper">
        <div class="auth-card">
          <div class="auth-brand">
            <div class="auth-logo"><img src="${LOGO_PATH}" alt="Logo"></div>
            <h1>Agrocomercial Antiquera</h1>
            <p>Bienvenido</p>
          </div>
          <div class="auth-tabs">
            <button class="auth-tab ${authMode === 'login' ? 'active' : ''}" data-mode="login">Iniciar sesión</button>
            <button class="auth-tab ${authMode === 'register' ? 'active' : ''}" data-mode="register">Registrarme</button>
          </div>
          <div id="auth-content"></div>
        </div>
      </div>
    `;
    app.querySelectorAll('.auth-tab').forEach(t => {
      t.onclick = () => { authMode = t.dataset.mode; renderAuth(); };
    });
    if (authMode === 'login') renderLogin();
    else renderRegister();
  }

  function renderLogin() {
    const c = document.getElementById('auth-content');
    c.innerHTML = `
      <form id="login-form" class="auth-form">
        <label>Correo</label>
        <input type="email" name="email" required autocomplete="email">
        <label>Contraseña</label>
        <input type="password" name="password" required autocomplete="current-password">
        <button type="submit" class="btn btn-primary btn-block">Entrar</button>
      </form>
    `;
    document.getElementById('login-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const btn = e.target.querySelector('button[type=submit]');
      await runAsync(btn, async () => {
        await DB.login(fd.get('email'), fd.get('password'));
      }, 'Entrando…');
    };
  }

  function renderRegister() {
    const c = document.getElementById('auth-content');
    c.innerHTML = `
      <p class="auth-info">El registro es solo para clientes. Las cuentas de vendedor las crea el administrador.</p>
      <form id="register-form" class="auth-form">
        <label>Nombre</label>
        <input type="text" name="nombre" required>
        <label>Apellido</label>
        <input type="text" name="apellido" required>
        <label>Teléfono</label>
        <input type="tel" name="telefono" required>
        <label>Correo</label>
        <input type="email" name="email" required>
        <label>Clave (mínimo 6 caracteres)</label>
        <input type="password" name="password" required minlength="6">
        <button type="submit" class="btn btn-primary btn-block">Crear cuenta</button>
      </form>
    `;
    document.getElementById('register-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const data = Object.fromEntries(fd.entries());
      const btn = e.target.querySelector('button[type=submit]');
      await runAsync(btn, async () => {
        await DB.registerClient(data);
        toast('¡Cuenta creada!');
      }, 'Creando cuenta…');
    };
  }

  // ============================================================
  // COMPONENTES COMPARTIDOS
  // ============================================================
  function sidebar(role, sections, current, userName) {
    const roleLabel = { admin: 'Administrador', vendedor: 'Vendedor', cliente: 'Cliente' }[role];
    return `
      <aside class="sidebar">
        <div class="sidebar-brand">
          <div class="brand-logo"><img src="${LOGO_PATH}" alt="Logo"></div>
          <div>
            <div class="brand-title">Agrocomercial</div>
            <div class="brand-sub">${escapeHtml(roleLabel)}</div>
          </div>
        </div>
        <nav class="sidebar-nav">
          ${sections.map(s => `
            <button class="nav-item ${current === s.id ? 'active' : ''}" data-section="${s.id}">
              <span class="nav-icon">${s.icon}</span>
              <span>${s.label}</span>
              ${s.badge ? `<span class="nav-badge">${s.badge}</span>` : ''}
            </button>
          `).join('')}
        </nav>
        <div class="sidebar-user">
          <div class="user-avatar">${escapeHtml((userName || '?').charAt(0).toUpperCase())}</div>
          <div class="user-info">
            <div class="user-name">${escapeHtml(userName)}</div>
            <div class="user-role">${escapeHtml(roleLabel)}</div>
          </div>
          <button class="btn-icon" id="logout-btn" title="Cerrar sesión">⎋</button>
        </div>
      </aside>
    `;
  }

  function productCard(p, opts) {
    opts = opts || {};
    const hasDiscount = p.precioDescuento && p.precioDescuento < p.precio;
    const img = p.imagen || '';
    return `
      <div class="product-card">
        <div class="product-image">
          ${img ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(p.nombre)}" onerror="this.parentNode.innerHTML='<div class=\\'no-image\\'>Sin imagen</div>'">` : `<div class="no-image">Sin imagen</div>`}
          ${hasDiscount ? `<span class="discount-badge">Oferta</span>` : ''}
        </div>
        <div class="product-body">
          <h3 class="product-name">${escapeHtml(p.nombre)}</h3>
          <div class="product-price">
            ${hasDiscount
              ? `<span class="price-old">${fmtCLP(p.precio)}</span><span class="price-new">${fmtCLP(p.precioDescuento)}</span>`
              : `<span class="price">${fmtCLP(p.precio)}</span>`}
          </div>
          ${opts.admin ? `
            <div class="product-actions">
              <button class="btn btn-small btn-secondary product-edit" data-id="${p.id}">Editar</button>
              <button class="btn btn-small btn-danger product-delete" data-id="${p.id}">Eliminar</button>
            </div>
          ` : ''}
          ${opts.cart ? `
            <button class="btn btn-primary btn-block add-to-cart" data-id="${p.id}">Agregar al carrito</button>
          ` : ''}
        </div>
      </div>
    `;
  }

  // ============================================================
  // ADMIN
  // ============================================================
  function renderAdmin() {
    const session = DB.getSession();
    const sections = [
      { id: 'productos',   label: 'Productos',          icon: '🌿' },
      { id: 'pedidos',     label: 'Pedidos pendientes', icon: '📦', badge: DB.getPendingOrdersCount() || 0 },
      { id: 'libro',       label: 'Libro de Registro',  icon: '📘' },
      { id: 'papelera',    label: 'Papelera',           icon: '🗑️', badge: DB.getTrashCount() || 0 },
      { id: 'mensajes',    label: 'Mensajes',           icon: '✉️', badge: DB.getUnreadMessagesCount() || 0 },
      { id: 'clientes',    label: 'Clientes',           icon: '👥' },
      { id: 'vendedores',  label: 'Usuarios internos',  icon: '🧑‍💼' },
      { id: 'sugerencias', label: 'Sugerencias',        icon: '💡', badge: DB.getUnreadSugerenciasCount() || 0 },
      { id: 'fiados',      label: 'Fiados',             icon: '💰' }
    ];
    sections.forEach(s => { if (s.badge === 0) delete s.badge; });

    app.innerHTML = `
      <div class="layout">
        ${sidebar('admin', sections, adminSection, session.name)}
        <main class="main-content" id="main-content"></main>
      </div>
    `;
    app.querySelectorAll('.nav-item').forEach(n => {
      n.onclick = () => { adminSection = n.dataset.section; renderAdmin(); };
    });
    document.getElementById('logout-btn').onclick = logout;

    const s = adminSection;
    if (s === 'productos')       renderAdminProductos();
    else if (s === 'pedidos')    renderAdminPedidos();
    else if (s === 'libro')      renderAdminLibro();
    else if (s === 'papelera')   renderAdminPapelera();
    else if (s === 'mensajes')   renderAdminMensajes();
    else if (s === 'clientes')   renderAdminClientes();
    else if (s === 'vendedores') renderAdminVendedores();
    else if (s === 'sugerencias') renderAdminSugerencias();
    else if (s === 'fiados')     renderAdminFiados();
  }

  function renderAdminProductos() {
    const main = document.getElementById('main-content');
    main.innerHTML = `
      <div class="page-header">
        <h2>Productos</h2>
        <button class="btn btn-primary" id="add-product-btn">+ Agregar producto</button>
      </div>
      <div class="search-bar">
        <input type="text" id="search" placeholder="Buscar producto..." class="search-input" autocomplete="off">
      </div>
      <div id="products-grid" class="product-grid"></div>
    `;

    const drawGrid = (q) => {
      q = (q || '').toLowerCase().trim();
      const prods = DB.getProducts().filter(p => (p.nombre || '').toLowerCase().includes(q));
      const grid = document.getElementById('products-grid');
      if (!prods.length) {
        grid.innerHTML = `<div class="empty-state">No hay productos ${q ? 'que coincidan con la búsqueda' : 'registrados todavía'}.</div>`;
        return;
      }
      grid.innerHTML = prods.map(p => productCard(p, { admin: true })).join('');
      grid.querySelectorAll('.product-edit').forEach(b => {
        b.onclick = () => openProductModal(DB.getProduct(b.dataset.id));
      });
      grid.querySelectorAll('.product-delete').forEach(b => {
        b.onclick = async () => {
          if (!confirm('¿Mover este producto a la papelera?\n\nPodrás restaurarlo desde la sección Papelera.')) return;
          await runAsync(b, async () => {
            await DB.deleteProduct(b.dataset.id);
            toast('Producto movido a la papelera');
          }, 'Eliminando…');
        };
      });
    };

    document.getElementById('add-product-btn').onclick = () => openProductModal();
    document.getElementById('search').oninput = (e) => drawGrid(e.target.value);
    drawGrid('');

    function openProductModal(existing) {
      const title = existing ? 'Editar producto' : 'Agregar producto';
      const currentImg = existing && existing.imagen ? existing.imagen : '';
      const isUrlImg = currentImg && !currentImg.startsWith('data:');
      const html = `
        <label>Nombre del producto</label>
        <input type="text" name="nombre" required value="${escapeHtml(existing ? existing.nombre : '')}">

        <label>Imagen del producto</label>
        <div class="image-picker">
          <input type="file" name="imagen-file" accept="image/*" id="img-file">
          <input type="url" name="imagen-url" placeholder="O pega una URL de imagen" value="${isUrlImg ? escapeHtml(currentImg) : ''}">
          <img id="img-preview" src="${escapeHtml(currentImg)}" ${currentImg ? '' : 'style="display:none"'} alt="">
        </div>

        <label>Precio (CLP)</label>
        <input type="number" name="precio" min="0" step="1" required value="${existing ? existing.precio : ''}">

        <label>Precio con descuento (CLP, opcional)</label>
        <input type="number" name="precioDescuento" min="0" step="1" value="${existing && existing.precioDescuento ? existing.precioDescuento : ''}">
      `;
      const m = modal(title, html, async (data, form, close) => {
        const fileInput = form.querySelector('#img-file');
        const urlInput = form.querySelector('[name="imagen-url"]');
        let imagen = urlInput.value || currentImg || '';

        if (fileInput.files && fileInput.files[0]) {
          // Sube a Firebase Storage
          imagen = await DB.uploadProductImage(fileInput.files[0]);
        }

        const payload = {
          nombre: data.nombre,
          imagen,
          precio: data.precio,
          precioDescuento: data.precioDescuento || null
        };

        if (existing) {
          await DB.updateProduct(existing.id, payload);
          toast('Producto actualizado');
        } else {
          await DB.addProduct(payload);
          toast('Producto agregado');
        }
      }, existing ? 'Actualizar' : 'Agregar');

      const fileInput = m.querySelector('#img-file');
      const urlInput = m.querySelector('[name="imagen-url"]');
      const preview = m.querySelector('#img-preview');
      fileInput.onchange = (e) => {
        if (e.target.files[0]) {
          const reader = new FileReader();
          reader.onload = (ev) => {
            preview.src = ev.target.result;
            preview.style.display = 'block';
            urlInput.value = '';
          };
          reader.readAsDataURL(e.target.files[0]);
        }
      };
      urlInput.oninput = () => {
        if (urlInput.value) {
          preview.src = urlInput.value;
          preview.style.display = 'block';
        }
      };
    }
  }

  function renderAdminPedidos() {
    const main = document.getElementById('main-content');
    const orders = DB.getOrders().filter(o => o.estado !== 'terminado');
    main.innerHTML = `
      <div class="page-header">
        <h2>Pedidos pendientes</h2>
        <button class="btn btn-primary" id="new-manual-order">+ Agregar pedido</button>
      </div>
      ${orders.length ? orders.map(o => orderRow(o, { admin: true })).join('') : '<div class="empty-state">No hay pedidos pendientes.</div>'}
    `;
    document.getElementById('new-manual-order').onclick = openNewOrderModal;
    main.querySelectorAll('[data-action]').forEach(b => {
      b.onclick = async () => {
        const id = b.dataset.id;
        const action = b.dataset.action;
        try {
          if (action === 'enviado')        { await DB.updateOrderStatus(id, 'enviado');   toast('Pedido marcado como enviado'); }
          else if (action === 'terminado') { await DB.updateOrderStatus(id, 'terminado'); toast('Pedido completado y registrado en el libro'); }
          else if (action === 'eliminar')  {
            if (!confirm('¿Mover pedido a la papelera?')) return;
            await DB.deleteOrder(id);
            toast('Pedido movido a la papelera');
          } else if (action === 'factura') {
            const current = DB.getOrders().find(o => o.id === id);
            if (current) {
              await DB.setOrderFactura(id, !current.conFactura);
              toast(!current.conFactura ? 'Marcado CON factura' : 'Marcado SIN factura');
            }
          }
        } catch (e) {
          console.error(e);
          toast('Error al actualizar el pedido', 'error');
        }
      };
    });
  }

  function orderRow(o, opts) {
    opts = opts || {};
    const itemsHtml = (o.items || []).map(it => `
      <div class="order-item">
        <span>${escapeHtml(it.nombre)} × ${it.cantidad}</span>
        <span>${fmtCLP(it.precio * it.cantidad)}</span>
      </div>
    `).join('');
    const facturaBadge = o.conFactura
      ? '<span class="factura-badge con">Con factura</span>'
      : '<span class="factura-badge sin">Sin factura</span>';
    return `
      <div class="order-card">
        <div class="order-head">
          <div>
            <div class="order-title">
              Pedido #${escapeHtml(String(o.id).slice(-6).toUpperCase())}
              ${o.manual ? '<span class="tag-manual">manual</span>' : ''}
            </div>
            <div class="order-meta">${fmtDate(o.createdAt)} · ${escapeHtml(o.clienteNombre)}</div>
          </div>
          <div class="order-badges">
            ${facturaBadge}
            <span class="status-badge status-${o.estado}">${o.estado}</span>
          </div>
        </div>
        <div class="order-items">${itemsHtml}</div>
        <div class="order-total"><strong>Total: ${fmtCLP(o.total)}</strong></div>
        <div class="order-details">
          <div><b>Tipo entrega:</b> ${escapeHtml(o.tipoEntrega === 'delivery' ? 'Delivery' : 'Retiro en local')}</div>
          ${o.tipoEntrega === 'delivery' ? `<div><b>Dirección:</b> ${escapeHtml(o.direccion)}</div>` : ''}
          <div><b>Nombre:</b> ${escapeHtml(o.nombrePersona)}</div>
          <div><b>Teléfono:</b> ${escapeHtml(o.telefono)}</div>
          ${o.correo ? `<div><b>Correo:</b> ${escapeHtml(o.correo)}</div>` : ''}
          <div><b>Facturación:</b> ${o.conFactura ? 'Con factura' : 'Sin factura'}</div>
          ${o.completedAt ? `<div><b>Completado:</b> ${fmtDate(o.completedAt)}</div>` : ''}
          ${o.deletedAt ? `<div><b>Eliminado:</b> ${fmtDate(o.deletedAt)}</div>` : ''}
          ${o.nota ? `<div style="grid-column:1/-1"><b>Nota:</b> ${escapeHtml(o.nota)}</div>` : ''}
        </div>
        ${opts.admin ? `
          <div class="order-actions">
            <button class="btn btn-small btn-secondary" data-action="factura" data-id="${o.id}">
              Cambiar a ${o.conFactura ? 'SIN' : 'CON'} factura
            </button>
            ${o.estado !== 'enviado' && o.estado !== 'terminado' ? `<button class="btn btn-small btn-secondary" data-action="enviado" data-id="${o.id}">Marcar enviado</button>` : ''}
            <button class="btn btn-small btn-primary" data-action="terminado" data-id="${o.id}">Marcar terminado</button>
            <button class="btn btn-small btn-danger" data-action="eliminar" data-id="${o.id}">Eliminar</button>
          </div>
        ` : ''}
        ${opts.trash ? `
          <div class="order-actions">
            <button class="btn btn-small btn-primary" data-trash-action="restore" data-id="${o.id}">Restaurar</button>
            <button class="btn btn-small btn-danger" data-trash-action="delete" data-id="${o.id}">Eliminar definitivamente</button>
          </div>
        ` : ''}
        ${opts.libro ? `
          <div class="order-actions">
            <button class="btn btn-small btn-danger" data-libro-action="delete" data-id="${o.id}">Eliminar del libro</button>
          </div>
        ` : ''}
      </div>
    `;
  }

  // ---------- Modal: Nuevo pedido manual ----------
  function openNewOrderModal() {
    const products = DB.getProducts();
    if (!products.length) return toast('Primero debes registrar productos', 'error');

    let items = [];

    const m = document.createElement('div');
    m.className = 'modal-overlay';
    m.innerHTML = `
      <div class="modal modal-lg">
        <div class="modal-header">
          <h3>Agregar pedido manualmente</h3>
          <button class="modal-close" type="button">×</button>
        </div>
        <form class="modal-body">
          <label>Productos disponibles</label>
          <div class="new-order-products">
            ${products.map(p => {
              const precio = p.precioDescuento || p.precio;
              return `
                <div class="new-order-prod-row">
                  <span class="nop-name">${escapeHtml(p.nombre)}</span>
                  <span class="nop-price">${fmtCLP(precio)}</span>
                  <button type="button" class="btn btn-small btn-secondary prod-add" data-id="${p.id}">+ Agregar</button>
                </div>
              `;
            }).join('')}
          </div>

          <label>Items del pedido</label>
          <div id="order-items-list" class="order-items-editable"></div>

          <label>Tipo de entrega</label>
          <select name="tipoEntrega" required id="new-tipo-entrega">
            <option value="retiro">Retiro en local</option>
            <option value="delivery">Delivery</option>
          </select>
          <div id="new-direccion-wrap" style="display:none">
            <label>Dirección de entrega</label>
            <input type="text" name="direccion">
          </div>

          <label>Facturación</label>
          <select name="conFactura" required>
            <option value="false">Sin factura</option>
            <option value="true">Con factura</option>
          </select>

          <label>Nombre del cliente</label>
          <input type="text" name="nombrePersona" required>
          <label>Teléfono</label>
          <input type="tel" name="telefono" required>
          <label>Correo (opcional)</label>
          <input type="email" name="correo">
          <label>Nota (opcional)</label>
          <textarea name="nota" rows="2"></textarea>

          <div class="modal-total">Total: <strong id="new-total">$0</strong></div>

          <div class="modal-footer">
            <button type="button" class="btn btn-secondary btn-cancel">Cancelar</button>
            <button type="submit" class="btn btn-primary">Crear pedido</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(m);

    const close = () => m.remove();
    m.querySelector('.modal-close').onclick = close;
    m.querySelector('.btn-cancel').onclick = close;
    m.onclick = (e) => { if (e.target === m) close(); };

    const form = m.querySelector('form');
    const itemsList = m.querySelector('#order-items-list');
    const totalEl = m.querySelector('#new-total');

    const updateItems = () => {
      if (!items.length) {
        itemsList.innerHTML = '<div class="muted-info">Aún no has agregado productos al pedido.</div>';
        totalEl.textContent = fmtCLP(0);
        return;
      }
      itemsList.innerHTML = items.map((it, idx) => `
        <div class="order-item-edit">
          <span class="oie-name">${escapeHtml(it.nombre)}</span>
          <div class="cart-qty">
            <button type="button" data-qty="-" data-idx="${idx}">−</button>
            <span>${it.cantidad}</span>
            <button type="button" data-qty="+" data-idx="${idx}">+</button>
          </div>
          <span class="oie-total">${fmtCLP(it.precio * it.cantidad)}</span>
          <button type="button" class="btn-icon item-remove" data-idx="${idx}" title="Quitar">×</button>
        </div>
      `).join('');
      const total = items.reduce((s, i) => s + i.precio * i.cantidad, 0);
      totalEl.textContent = fmtCLP(total);

      itemsList.querySelectorAll('[data-qty]').forEach(b => {
        b.onclick = () => {
          const idx = parseInt(b.dataset.idx, 10);
          if (b.dataset.qty === '+') items[idx].cantidad++;
          else { items[idx].cantidad--; if (items[idx].cantidad <= 0) items.splice(idx, 1); }
          updateItems();
        };
      });
      itemsList.querySelectorAll('.item-remove').forEach(b => {
        b.onclick = () => { items.splice(parseInt(b.dataset.idx, 10), 1); updateItems(); };
      });
    };

    m.querySelectorAll('.prod-add').forEach(b => {
      b.onclick = () => {
        const p = DB.getProduct(b.dataset.id);
        if (!p) return;
        const precio = p.precioDescuento || p.precio;
        const existing = items.find(i => i.id === p.id);
        if (existing) existing.cantidad++;
        else items.push({ id: p.id, nombre: p.nombre, precio, cantidad: 1 });
        updateItems();
      };
    });

    const tipoSelect = m.querySelector('#new-tipo-entrega');
    const direcWrap = m.querySelector('#new-direccion-wrap');
    const direcInput = m.querySelector('[name="direccion"]');
    tipoSelect.onchange = () => {
      const isDel = tipoSelect.value === 'delivery';
      direcWrap.style.display = isDel ? 'block' : 'none';
      direcInput.required = isDel;
    };

    form.onsubmit = async (e) => {
      e.preventDefault();
      if (!items.length) return toast('Agrega al menos un producto', 'error');
      const data = {};
      form.querySelectorAll('[name]').forEach(el => { data[el.name] = el.value; });
      if (data.tipoEntrega === 'delivery' && !data.direccion) {
        return toast('Ingresa una dirección de entrega', 'error');
      }
      const total = items.reduce((s, i) => s + i.precio * i.cantidad, 0);
      const submitBtn = form.querySelector('button[type=submit]');
      await runAsync(submitBtn, async () => {
        await DB.addOrder({
          clienteId: 'manual',
          clienteNombre: data.nombrePersona,
          items: items.slice(),
          total,
          tipoEntrega: data.tipoEntrega,
          direccion: data.direccion || '',
          nombrePersona: data.nombrePersona,
          telefono: data.telefono,
          correo: data.correo,
          nota: data.nota,
          conFactura: data.conFactura === 'true',
          manual: true
        });
        toast('Pedido creado manualmente');
        close();
      }, 'Creando pedido…');
    };

    updateItems();
    setTimeout(() => {
      const first = form.querySelector('[name="nombrePersona"]');
      if (first) first.focus();
    }, 50);
  }

  function renderAdminPapelera() {
    const main = document.getElementById('main-content');

    const TRASH_TYPES = [
      { key: 'orders',      label: 'Pedidos',     singular: 'pedido' },
      { key: 'products',    label: 'Productos',   singular: 'producto' },
      { key: 'libro',       label: 'Libro',       singular: 'entrada del libro' },
      { key: 'messages',    label: 'Mensajes',    singular: 'mensaje' },
      { key: 'sugerencias', label: 'Sugerencias', singular: 'sugerencia' },
      { key: 'fiados',      label: 'Fiados',      singular: 'fiado' },
      { key: 'users',       label: 'Vendedores',  singular: 'vendedor' }
    ];

    // Si la pestaña guardada no existe, vuelve a pedidos.
    if (!TRASH_TYPES.find(t => t.key === papeleraTab)) papeleraTab = 'orders';

    const activeType = TRASH_TYPES.find(t => t.key === papeleraTab);
    const items = DB.getTrashByType(papeleraTab);
    const totalCount = DB.getTrashCount();

    const tabsHtml = TRASH_TYPES.map(t => {
      const count = DB.getTrashCountByType(t.key);
      const isActive = t.key === papeleraTab ? 'active' : '';
      return `<button class="trash-tab ${isActive}" data-trash-tab="${t.key}">
        ${escapeHtml(t.label)}${count ? ` <span class="trash-tab-count">${count}</span>` : ''}
      </button>`;
    }).join('');

    main.innerHTML = `
      <div class="page-header">
        <h2>Papelera de reciclaje</h2>
        ${items.length ? `<button class="btn btn-danger" id="empty-trash-section">Vaciar ${escapeHtml(activeType.label).toLowerCase()}</button>` : ''}
      </div>
      <p class="info-muted">
        Nada se borra directamente: todo lo eliminado se conserva aquí y puede recuperarse.
        ${totalCount ? `Hay <b>${totalCount}</b> elementos en total en la papelera.` : ''}
      </p>
      <div class="trash-tabs">${tabsHtml}</div>
      <div id="trash-content">
        ${items.length
          ? items.map(it => trashItemCard(it, papeleraTab)).join('')
          : `<div class="empty-state">No hay ${escapeHtml(activeType.label).toLowerCase()} en la papelera.</div>`}
      </div>
    `;

    // Cambio de pestaña
    main.querySelectorAll('[data-trash-tab]').forEach(btn => {
      btn.onclick = () => {
        papeleraTab = btn.dataset.trashTab;
        renderAdminPapelera();
      };
    });

    // Vaciar sección actual
    const emptyBtn = document.getElementById('empty-trash-section');
    if (emptyBtn) {
      emptyBtn.onclick = async () => {
        if (!confirm(`¿Vaciar completamente la sección "${activeType.label}"? Esta acción no se puede deshacer.`)) return;
        await runAsync(emptyBtn, async () => {
          await DB.emptyTrashOfType(papeleraTab);
          toast('Sección vaciada');
        }, 'Vaciando…');
      };
    }

    // Restaurar / eliminar definitivo
    main.querySelectorAll('[data-trash-action]').forEach(b => {
      b.onclick = async () => {
        const id = b.dataset.id;
        const type = b.dataset.type;
        const singular = (TRASH_TYPES.find(t => t.key === type) || { singular: 'elemento' }).singular;
        if (b.dataset.trashAction === 'restore') {
          await runAsync(b, async () => {
            await DB.restoreFromTrash(type, id);
            toast(singular.charAt(0).toUpperCase() + singular.slice(1) + ' restaurado');
          }, 'Restaurando…');
        } else {
          if (!confirm(`¿Eliminar este ${singular} permanentemente? No se podrá recuperar.`)) return;
          await runAsync(b, async () => {
            await DB.permanentDeleteFromTrash(type, id);
            toast(singular.charAt(0).toUpperCase() + singular.slice(1) + ' eliminado definitivamente');
          }, 'Eliminando…');
        }
      };
    });
  }

  // Render para cada tipo en la papelera.
  function trashItemCard(item, type) {
    const actions = `
      <div class="trash-actions">
        <button class="btn btn-small btn-primary" data-trash-action="restore" data-type="${type}" data-id="${item.id}">Restaurar</button>
        <button class="btn btn-small btn-danger" data-trash-action="delete" data-type="${type}" data-id="${item.id}">Eliminar definitivamente</button>
      </div>
    `;
    const deletedMeta = `<div class="trash-meta">Eliminado: ${fmtDate(item.deletedAt)}</div>`;

    if (type === 'orders' || type === 'libro') {
      return `
        <div class="trash-card">
          ${orderRow(item, {})}
          ${deletedMeta}
          ${actions}
        </div>
      `;
    }

    if (type === 'products') {
      const hasDiscount = item.precioDescuento && item.precioDescuento < item.precio;
      return `
        <div class="trash-card">
          <div class="trash-row">
            <div class="trash-thumb">
              ${item.imagen ? `<img src="${escapeHtml(item.imagen)}" alt="">` : '<div class="no-image">Sin imagen</div>'}
            </div>
            <div class="trash-body">
              <div class="trash-title">${escapeHtml(item.nombre || '(sin nombre)')}</div>
              <div class="trash-sub">
                ${hasDiscount
                  ? `<span class="price-old">${fmtCLP(item.precio)}</span> <span class="price-new">${fmtCLP(item.precioDescuento)}</span>`
                  : fmtCLP(item.precio)}
              </div>
              ${deletedMeta}
            </div>
          </div>
          ${actions}
        </div>
      `;
    }

    if (type === 'messages' || type === 'sugerencias') {
      return `
        <div class="trash-card">
          <div class="message-head">
            <div>
              <strong>${escapeHtml(item.fromName || '(sin autor)')}</strong>
              ${item.fromRole ? `<span class="message-role">${escapeHtml(item.fromRole)}</span>` : ''}
            </div>
            <div class="message-date">${fmtDate(item.createdAt)}</div>
          </div>
          <div class="message-body">${escapeHtml(item.texto || '')}</div>
          ${deletedMeta}
          ${actions}
        </div>
      `;
    }

    if (type === 'fiados') {
      return `
        <div class="trash-card">
          <div class="trash-row">
            <div class="trash-body">
              <div class="trash-title">${escapeHtml(item.nombre || '(sin nombre)')}</div>
              <div class="trash-sub">
                ${fmtCLP(item.monto)}
                ${item.fechaFiado ? ` · Fiado: ${escapeHtml(fmtDateOnly(item.fechaFiado))}` : ''}
                ${item.pagado ? ' · <span class="paid-badge">Pagado</span>' : ''}
              </div>
              ${item.notas ? `<div class="fiado-notes">${escapeHtml(item.notas)}</div>` : ''}
              ${deletedMeta}
            </div>
          </div>
          ${actions}
        </div>
      `;
    }

    if (type === 'users') {
      return `
        <div class="trash-card">
          <div class="trash-row">
            <div class="trash-body">
              <div class="trash-title">${escapeHtml(item.username || item.email || '(sin nombre)')}</div>
              <div class="trash-sub">${escapeHtml(item.email || '')} · ${escapeHtml(item.role || 'vendedor')}</div>
              ${deletedMeta}
            </div>
          </div>
          ${actions}
        </div>
      `;
    }

    // Fallback genérico
    return `
      <div class="trash-card">
        <div class="trash-body">
          <div class="trash-title">${escapeHtml(item.id)}</div>
          ${deletedMeta}
        </div>
        ${actions}
      </div>
    `;
  }

  function renderAdminLibro() {
    const main = document.getElementById('main-content');
    const libro = DB.getLibro();
    const totalVentas = libro.reduce((s, o) => s + (o.total || 0), 0);
    main.innerHTML = `
      <div class="page-header">
        <h2>Libro de Registro</h2>
        ${libro.length ? '<button class="btn btn-primary" id="libro-csv">Descargar CSV</button>' : ''}
      </div>
      <p class="info-muted">Registro detallado de todos los pedidos completados con éxito.</p>
      ${libro.length ? `
        <div class="libro-stats">
          <div class="stat-card">
            <div class="stat-label">Pedidos completados</div>
            <div class="stat-value">${libro.length}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Total facturado</div>
            <div class="stat-value">${fmtCLP(totalVentas)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Con factura</div>
            <div class="stat-value">${libro.filter(o => o.conFactura).length}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Sin factura</div>
            <div class="stat-value">${libro.filter(o => !o.conFactura).length}</div>
          </div>
        </div>
        <div class="search-bar">
          <input type="text" id="libro-search" class="search-input" placeholder="Buscar en el libro..." autocomplete="off">
        </div>
        <div id="libro-list">
          ${libro.map(o => orderRow(o, { libro: true })).join('')}
        </div>
      ` : '<div class="empty-state">El libro de registro aún no contiene operaciones.</div>'}
    `;

    const searchInput = document.getElementById('libro-search');
    if (searchInput) {
      searchInput.oninput = (e) => {
        const q = e.target.value.toLowerCase().trim();
        const filtered = libro.filter(o =>
          ((o.clienteNombre || '') + ' ' + (o.nombrePersona || '') + ' ' + (o.telefono || '') + ' ' + o.id).toLowerCase().includes(q)
        );
        const list = document.getElementById('libro-list');
        list.innerHTML = filtered.length
          ? filtered.map(o => orderRow(o, { libro: true })).join('')
          : '<div class="empty-state">Sin coincidencias.</div>';
        bindLibroActions();
      };
    }

    const csvBtn = document.getElementById('libro-csv');
    if (csvBtn) {
      csvBtn.onclick = () => {
        const headers = ['ID', 'Fecha creación', 'Fecha completado', 'Cliente', 'Teléfono', 'Tipo entrega', 'Dirección', 'Facturación', 'Items', 'Total'];
        const rows = libro.map(o => [
          o.id,
          fmtDate(o.createdAt),
          fmtDate(o.completedAt),
          o.nombrePersona,
          o.telefono,
          o.tipoEntrega === 'delivery' ? 'Delivery' : 'Retiro en local',
          o.direccion || '',
          o.conFactura ? 'Con factura' : 'Sin factura',
          (o.items || []).map(i => `${i.nombre} x${i.cantidad}`).join(' | '),
          o.total
        ]);
        const csv = [headers, ...rows]
          .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
          .join('\n');
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'libro_registro_' + new Date().toISOString().slice(0, 10) + '.csv';
        a.click();
        URL.revokeObjectURL(url);
        toast('Descarga iniciada');
      };
    }

    function bindLibroActions() {
      document.querySelectorAll('[data-libro-action]').forEach(b => {
        b.onclick = async () => {
          const id = b.dataset.id;
          if (!confirm('¿Mover esta operación a la papelera?\n\nPodrás restaurarla desde la sección Papelera.')) return;
          await runAsync(b, async () => {
            await DB.deleteLibroEntry(id);
            toast('Entrada movida a la papelera');
          }, 'Eliminando…');
        };
      });
    }
    bindLibroActions();
  }

  function renderAdminMensajes() {
    const main = document.getElementById('main-content');
    const msgs = DB.getMessages();
    main.innerHTML = `
      <div class="page-header"><h2>Mensajes</h2></div>
      <div class="messages-list">
        ${msgs.length ? msgs.map(messageCard).join('') : '<div class="empty-state">No hay mensajes.</div>'}
      </div>
    `;
    main.querySelectorAll('[data-msg-action]').forEach(b => {
      b.onclick = async () => {
        const id = b.dataset.id;
        if (b.dataset.msgAction === 'leer') {
          await runAsync(b, async () => {
            await DB.markMessageRead(id);
            toast('Mensaje marcado como leído');
          }, 'Guardando…');
        } else if (b.dataset.msgAction === 'eliminar') {
          if (!confirm('¿Mover este mensaje a la papelera?\n\nPodrás restaurarlo desde la sección Papelera.')) return;
          await runAsync(b, async () => {
            await DB.deleteMessage(id);
            toast('Mensaje movido a la papelera');
          }, 'Eliminando…');
        }
      };
    });
  }

  function messageCard(m) {
    return `
      <div class="message-card ${m.leido ? 'read' : 'unread'}">
        <div class="message-head">
          <div>
            <strong>${escapeHtml(m.fromName)}</strong>
            <span class="message-role">${escapeHtml(m.fromRole)}</span>
          </div>
          <div class="message-date">${fmtDate(m.createdAt)}</div>
        </div>
        <div class="message-body">${escapeHtml(m.texto)}</div>
        <div class="message-actions">
          ${!m.leido ? `<button class="btn btn-small btn-secondary" data-msg-action="leer" data-id="${m.id}">Marcar leído</button>` : ''}
          <button class="btn btn-small btn-danger" data-msg-action="eliminar" data-id="${m.id}">Eliminar</button>
        </div>
      </div>
    `;
  }

  function renderAdminClientes() {
    const main = document.getElementById('main-content');
    const clients = DB.getClients();
    main.innerHTML = `
      <div class="page-header">
        <h2>Clientes</h2>
        <button class="btn btn-primary" id="download-csv">Descargar CSV</button>
      </div>
      <div class="search-bar">
        <input type="text" id="c-search" class="search-input" placeholder="Buscar cliente..." autocomplete="off">
      </div>
      <div id="clients-table-wrap"></div>
    `;
    const draw = (q) => {
      q = (q || '').toLowerCase().trim();
      const filtered = clients.filter(c =>
        ((c.nombre || '') + ' ' + (c.apellido || '') + ' ' + (c.email || '') + ' ' + (c.telefono || '')).toLowerCase().includes(q)
      );
      const wrap = document.getElementById('clients-table-wrap');
      if (!filtered.length) { wrap.innerHTML = '<div class="empty-state">Sin clientes registrados.</div>'; return; }
      wrap.innerHTML = `
        <table class="data-table">
          <thead>
            <tr><th>Nombre</th><th>Apellido</th><th>Teléfono</th><th>Correo</th><th>Registrado</th></tr>
          </thead>
          <tbody>
            ${filtered.map(c => `
              <tr>
                <td>${escapeHtml(c.nombre)}</td>
                <td>${escapeHtml(c.apellido)}</td>
                <td>${escapeHtml(c.telefono)}</td>
                <td>${escapeHtml(c.email)}</td>
                <td>${fmtDate(c.createdAt)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    };
    draw('');
    document.getElementById('c-search').oninput = (e) => draw(e.target.value);
    document.getElementById('download-csv').onclick = () => {
      if (!clients.length) return toast('No hay clientes para descargar', 'error');
      const headers = ['Nombre', 'Apellido', 'Teléfono', 'Correo', 'Fecha registro'];
      const rows = clients.map(c => [c.nombre, c.apellido, c.telefono, c.email, fmtDate(c.createdAt)]);
      const csv = [headers, ...rows]
        .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
        .join('\n');
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'clientes_' + new Date().toISOString().slice(0, 10) + '.csv';
      a.click();
      URL.revokeObjectURL(url);
      toast('Descarga iniciada');
    };
  }

  function renderAdminVendedores() {
    const main = document.getElementById('main-content');
    const usuarios = DB.getUsuariosInternos();
    const session = DB.getSession();
    main.innerHTML = `
      <div class="page-header">
        <h2>Usuarios internos</h2>
        <button class="btn btn-primary" id="add-vendor">+ Crear usuario</button>
      </div>
      <p class="info-muted">Administradores y vendedores del sistema. Los administradores tienen acceso completo; los vendedores solo ven productos, pedidos y libro.</p>
      ${usuarios.length ? `
        <table class="data-table">
          <thead><tr><th>Usuario</th><th>Correo</th><th>Rol</th><th>Creado</th><th></th></tr></thead>
          <tbody>
            ${usuarios.map(v => {
              const isSelf = session && session.uid === v.id;
              const isAdmin = v.role === 'admin';
              return `
                <tr>
                  <td>${escapeHtml(v.username || '-')}${isSelf ? ' <span class="role-badge self">tú</span>' : ''}</td>
                  <td>${escapeHtml(v.email || '-')}</td>
                  <td><span class="role-badge ${isAdmin ? 'admin' : 'vendedor'}">${isAdmin ? 'Administrador' : 'Vendedor'}</span></td>
                  <td>${fmtDate(v.createdAt)}</td>
                  <td style="text-align:right">
                    ${isSelf
                      ? '<span class="info-muted" style="font-size:12px">(cuenta activa)</span>'
                      : `<button class="btn btn-small btn-danger" data-del="${v.id}">Eliminar</button>`}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      ` : '<div class="empty-state">No hay usuarios internos todavía.</div>'}
    `;
    document.getElementById('add-vendor').onclick = () => {
      modal('Crear usuario interno', `
        <p class="info-muted">Se creará una cuenta con Firebase Auth. Recuerda compartir estas credenciales con la persona.</p>
        <label>Nombre de usuario (para mostrar)</label>
        <input type="text" name="username" required autocomplete="off">
        <label>Correo</label>
        <input type="email" name="email" required autocomplete="off">
        <label>Clave (mínimo 6 caracteres)</label>
        <input type="password" name="password" required minlength="6" autocomplete="new-password">
        <label>Rol</label>
        <select name="role" required>
          <option value="vendedor" selected>Vendedor (acceso limitado)</option>
          <option value="admin">Administrador (acceso completo)</option>
        </select>
      `, async (data) => {
        await DB.addUsuarioInterno(data.email, data.password, data.username, data.role);
        toast(data.role === 'admin' ? 'Administrador creado' : 'Vendedor creado');
      }, 'Crear');
    };
    main.querySelectorAll('[data-del]').forEach(b => {
      b.onclick = async () => {
        if (!confirm('¿Mover este usuario a la papelera?\n\nPodrás restaurarlo desde la sección Papelera. El usuario de Firebase Auth seguirá existiendo hasta que lo borres desde la consola.')) return;
        await runAsync(b, async () => {
          await DB.deleteVendedor(b.dataset.del);
          toast('Usuario movido a la papelera');
        }, 'Eliminando…');
      };
    });
  }

  function renderAdminSugerencias() {
    const main = document.getElementById('main-content');
    const sugs = DB.getSugerencias();
    main.innerHTML = `
      <div class="page-header"><h2>Sugerencias de clientes</h2></div>
      <p class="info-muted">Las sugerencias enviadas por los clientes sobre el local se muestran aquí.</p>
      <div class="messages-list">
        ${sugs.length ? sugs.map(s => `
          <div class="message-card ${s.leido ? 'read' : 'unread'}">
            <div class="message-head">
              <div>
                <strong>${escapeHtml(s.fromName)}</strong>
                <span class="message-role">Cliente</span>
              </div>
              <div class="message-date">${fmtDate(s.createdAt)}</div>
            </div>
            <div class="message-body">${escapeHtml(s.texto)}</div>
            <div class="message-actions">
              ${!s.leido ? `<button class="btn btn-small btn-secondary" data-sug-action="leer" data-id="${s.id}">Marcar leída</button>` : ''}
              <button class="btn btn-small btn-danger" data-sug-action="eliminar" data-id="${s.id}">Eliminar</button>
            </div>
          </div>
        `).join('') : '<div class="empty-state">No hay sugerencias todavía.</div>'}
      </div>
    `;
    main.querySelectorAll('[data-sug-action]').forEach(b => {
      b.onclick = async () => {
        const id = b.dataset.id;
        if (b.dataset.sugAction === 'leer') {
          await runAsync(b, async () => {
            await DB.markSugerenciaRead(id);
            toast('Sugerencia marcada como leída');
          }, 'Guardando…');
        } else if (b.dataset.sugAction === 'eliminar') {
          if (!confirm('¿Mover esta sugerencia a la papelera?\n\nPodrás restaurarla desde la sección Papelera.')) return;
          await runAsync(b, async () => {
            await DB.deleteSugerencia(id);
            toast('Sugerencia movida a la papelera');
          }, 'Eliminando…');
        }
      };
    });
  }

  function renderAdminFiados() {
    const main = document.getElementById('main-content');
    const fiados = DB.getFiados();
    main.innerHTML = `
      <div class="page-header">
        <h2>Fiados</h2>
        <button class="btn btn-primary" id="add-fiado">+ Agregar fiado</button>
      </div>
      <div class="fiados-list">
        ${fiados.length ? fiados.map(fiadoCard).join('') : '<div class="empty-state">No hay fiados registrados.</div>'}
      </div>
    `;
    document.getElementById('add-fiado').onclick = () => {
      modal('Agregar fiado', `
        <label>Nombre de la persona</label>
        <input type="text" name="nombre" required>
        <label>Fecha de fiado</label>
        <input type="date" name="fechaFiado" required value="${new Date().toISOString().slice(0, 10)}">
        <label>Fecha límite (opcional)</label>
        <input type="date" name="fechaLimite">
        <label>Monto (CLP)</label>
        <input type="number" name="monto" min="0" step="1" required>
        <label>Notas</label>
        <textarea name="notas" rows="3"></textarea>
      `, async (data) => {
        await DB.addFiado(data);
        toast('Fiado registrado');
      }, 'Agregar');
    };
    main.querySelectorAll('[data-f-action]').forEach(b => {
      b.onclick = async () => {
        const id = b.dataset.id;
        if (b.dataset.fAction === 'pagar') {
          await runAsync(b, async () => {
            await DB.markFiadoPaid(id);
            toast('Fiado marcado como pagado');
          }, 'Guardando…');
        } else if (b.dataset.fAction === 'eliminar') {
          if (!confirm('¿Mover este fiado a la papelera?\n\nPodrás restaurarlo desde la sección Papelera.')) return;
          await runAsync(b, async () => {
            await DB.deleteFiado(id);
            toast('Fiado movido a la papelera');
          }, 'Eliminando…');
        }
      };
    });
  }

  function fiadoCard(f) {
    return `
      <div class="fiado-card ${f.pagado ? 'paid' : ''}">
        <div class="fiado-head">
          <div>
            <div class="fiado-name">${escapeHtml(f.nombre)}</div>
            <div class="fiado-meta">
              Fiado: ${escapeHtml(fmtDateOnly(f.fechaFiado))}
              ${f.fechaLimite ? ' · Límite: ' + escapeHtml(fmtDateOnly(f.fechaLimite)) : ''}
            </div>
          </div>
          <div class="fiado-amount">${fmtCLP(f.monto)}</div>
        </div>
        ${f.notas ? `<div class="fiado-notes">${escapeHtml(f.notas)}</div>` : ''}
        <div class="fiado-actions">
          ${!f.pagado
            ? `<button class="btn btn-small btn-primary" data-f-action="pagar" data-id="${f.id}">Marcar pagado</button>`
            : `<span class="paid-badge">Pagado</span>`}
          <button class="btn btn-small btn-danger" data-f-action="eliminar" data-id="${f.id}">Eliminar</button>
        </div>
      </div>
    `;
  }

  // ============================================================
  // VENDEDOR
  // ============================================================
  function renderVendedor() {
    const session = DB.getSession();
    const sections = [
      { id: 'productos', label: 'Productos',      icon: '🌿' },
      { id: 'mensaje',   label: 'Enviar mensaje', icon: '✉️' }
    ];
    app.innerHTML = `
      <div class="layout">
        ${sidebar('vendedor', sections, vendedorSection, session.name)}
        <main class="main-content" id="main-content"></main>
      </div>
    `;
    app.querySelectorAll('.nav-item').forEach(n => {
      n.onclick = () => { vendedorSection = n.dataset.section; renderVendedor(); };
    });
    document.getElementById('logout-btn').onclick = logout;

    if (vendedorSection === 'productos') renderCatalogo(false);
    else renderMensajeForm('vendedor');
  }

  function renderCatalogo(withCart) {
    const main = document.getElementById('main-content');
    main.innerHTML = `
      <div class="page-header"><h2>Catálogo de productos</h2></div>
      <div class="search-bar">
        <input type="text" id="search" class="search-input" placeholder="Buscar producto..." autocomplete="off">
      </div>
      <div id="products-grid" class="product-grid"></div>
    `;
    const draw = (q) => {
      q = (q || '').toLowerCase().trim();
      const prods = DB.getProducts().filter(p => (p.nombre || '').toLowerCase().includes(q));
      const grid = document.getElementById('products-grid');
      if (!prods.length) {
        grid.innerHTML = `<div class="empty-state">${q ? 'No hay productos que coincidan.' : 'Aún no hay productos disponibles.'}</div>`;
        return;
      }
      grid.innerHTML = prods.map(p => productCard(p, { cart: withCart })).join('');
      if (withCart) {
        grid.querySelectorAll('.add-to-cart').forEach(b => {
          b.onclick = () => {
            const p = DB.getProduct(b.dataset.id);
            if (!p) return;
            const precio = p.precioDescuento || p.precio;
            const existing = cart.find(i => i.id === p.id);
            if (existing) existing.cantidad++;
            else cart.push({ id: p.id, nombre: p.nombre, precio, cantidad: 1 });
            toast('Agregado al carrito');
            renderCliente();
          };
        });
      }
    };
    draw('');
    document.getElementById('search').oninput = (e) => draw(e.target.value);
  }

  function renderMensajeForm(role) {
    const main = document.getElementById('main-content');
    main.innerHTML = `
      <div class="page-header"><h2>Enviar mensaje al administrador</h2></div>
      <div class="card">
        <form id="msg-form">
          <label>Tu mensaje</label>
          <textarea name="texto" rows="5" required placeholder="Escribe aquí tu mensaje..."></textarea>
          <button type="submit" class="btn btn-primary">Enviar mensaje</button>
        </form>
      </div>
    `;
    document.getElementById('msg-form').onsubmit = async (e) => {
      e.preventDefault();
      const texto = e.target.texto.value.trim();
      if (!texto) return;
      const session = DB.getSession();
      const btn = e.target.querySelector('button[type=submit]');
      await runAsync(btn, async () => {
        await DB.addMessage({
          fromId: session.uid,
          fromName: session.name,
          fromRole: role,
          texto
        });
        toast('Mensaje enviado al administrador');
        e.target.reset();
      }, 'Enviando…');
    };
  }

  // ============================================================
  // CLIENTE
  // ============================================================
  function renderCliente() {
    const session = DB.getSession();
    const cartCount = cart.reduce((s, i) => s + i.cantidad, 0);
    const sections = [
      { id: 'productos',    label: 'Productos',                 icon: '🌿' },
      { id: 'carrito',      label: 'Carrito',                   icon: '🛒', badge: cartCount || undefined },
      { id: 'sugerencias',  label: 'Sugerencias para el local', icon: '💡' }
    ];
    sections.forEach(s => { if (!s.badge) delete s.badge; });

    app.innerHTML = `
      <div class="layout">
        ${sidebar('cliente', sections, clienteSection, session.name)}
        <main class="main-content" id="main-content"></main>
      </div>
    `;
    app.querySelectorAll('.nav-item').forEach(n => {
      n.onclick = () => { clienteSection = n.dataset.section; renderCliente(); };
    });
    document.getElementById('logout-btn').onclick = logout;

    if (clienteSection === 'productos') renderCatalogo(true);
    else if (clienteSection === 'carrito') renderCarrito();
    else if (clienteSection === 'sugerencias') renderSugerenciaForm();
  }

  function renderCarrito() {
    const main = document.getElementById('main-content');
    const total = cart.reduce((s, i) => s + i.precio * i.cantidad, 0);
    main.innerHTML = `
      <div class="page-header"><h2>Mi carrito</h2></div>
      ${cart.length ? `
        <div class="cart-list">
          ${cart.map((i, idx) => `
            <div class="cart-item">
              <div class="cart-item-info">
                <div class="cart-item-name">${escapeHtml(i.nombre)}</div>
                <div class="cart-item-price">${fmtCLP(i.precio)} c/u</div>
              </div>
              <div class="cart-qty">
                <button data-qty="-" data-idx="${idx}">−</button>
                <span>${i.cantidad}</span>
                <button data-qty="+" data-idx="${idx}">+</button>
              </div>
              <div class="cart-item-total">${fmtCLP(i.precio * i.cantidad)}</div>
              <button class="btn-icon cart-remove" data-idx="${idx}" title="Quitar">×</button>
            </div>
          `).join('')}
        </div>
        <div class="cart-summary">
          <div class="cart-total"><span>Total:</span> <strong>${fmtCLP(total)}</strong></div>
          <button class="btn btn-primary btn-large btn-block" id="send-order">Enviar solicitud de pedido</button>
        </div>
      ` : '<div class="empty-state">Tu carrito está vacío.</div>'}
    `;
    if (!cart.length) return;
    main.querySelectorAll('[data-qty]').forEach(b => {
      b.onclick = () => {
        const idx = parseInt(b.dataset.idx, 10);
        if (b.dataset.qty === '+') cart[idx].cantidad++;
        else {
          cart[idx].cantidad--;
          if (cart[idx].cantidad <= 0) cart.splice(idx, 1);
        }
        renderCliente();
      };
    });
    main.querySelectorAll('.cart-remove').forEach(b => {
      b.onclick = () => {
        cart.splice(parseInt(b.dataset.idx, 10), 1);
        renderCliente();
      };
    });
    document.getElementById('send-order').onclick = () => openOrderModal(total);
  }

  function renderSugerenciaForm() {
    const main = document.getElementById('main-content');
    main.innerHTML = `
      <div class="page-header"><h2>Sugerencias para el local</h2></div>
      <p class="info-muted">Envía una sugerencia al administrador del local. Tu opinión nos ayuda a mejorar.</p>
      <div class="card">
        <form id="sug-form">
          <label>Tu sugerencia</label>
          <textarea name="texto" rows="5" required placeholder="Escribe aquí tu sugerencia..."></textarea>
          <button type="submit" class="btn btn-primary">Enviar sugerencia</button>
        </form>
      </div>
    `;
    document.getElementById('sug-form').onsubmit = async (e) => {
      e.preventDefault();
      const texto = e.target.texto.value.trim();
      if (!texto) return;
      const session = DB.getSession();
      const btn = e.target.querySelector('button[type=submit]');
      await runAsync(btn, async () => {
        await DB.addSugerencia({
          fromId: session.uid,
          fromName: session.name,
          texto
        });
        toast('¡Sugerencia enviada! Gracias por tu aporte.');
        e.target.reset();
      }, 'Enviando…');
    };
  }

  function openOrderModal(total) {
    const session = DB.getSession();
    const client = DB.findClientById(session.uid);
    modal('Solicitud de pedido', `
      <label>Tipo de entrega</label>
      <select name="tipoEntrega" required id="tipo-entrega">
        <option value="retiro">Retiro en local</option>
        <option value="delivery">Delivery</option>
      </select>
      <div id="direccion-wrap" style="display:none">
        <label>Dirección de entrega</label>
        <input type="text" name="direccion">
      </div>
      <label>Nombre de la persona</label>
      <input type="text" name="nombrePersona" required value="${escapeHtml(((client && client.nombre) || '') + ' ' + ((client && client.apellido) || ''))}">
      <label>Teléfono</label>
      <input type="tel" name="telefono" required value="${escapeHtml((client && client.telefono) || '')}">
      <label>Correo (opcional)</label>
      <input type="email" name="correo" value="${escapeHtml((client && client.email) || session.email || '')}">
      <label>Nota (opcional)</label>
      <textarea name="nota" rows="3" placeholder="Indicaciones adicionales..."></textarea>
      <div class="modal-total">Total a pagar: <strong>${fmtCLP(total)}</strong></div>
    `, async (data) => {
      if (data.tipoEntrega === 'delivery' && !data.direccion) {
        toast('Ingresa una dirección de entrega', 'error');
        return false;
      }
      await DB.addOrder({
        clienteId: session.uid,
        clienteNombre: session.name,
        items: cart.slice(),
        total,
        tipoEntrega: data.tipoEntrega,
        direccion: data.direccion || '',
        nombrePersona: data.nombrePersona,
        telefono: data.telefono,
        correo: data.correo,
        nota: data.nota
      });
      cart = [];
      toast('¡Solicitud enviada!');
      clienteSection = 'productos';
      renderCliente();
    }, 'Enviar solicitud');

    const tipo = document.getElementById('tipo-entrega');
    const wrap = document.getElementById('direccion-wrap');
    const dirInput = document.querySelector('[name="direccion"]');
    tipo.onchange = () => {
      const isDelivery = tipo.value === 'delivery';
      wrap.style.display = isDelivery ? 'block' : 'none';
      if (dirInput) dirInput.required = isDelivery;
    };
  }

  // ============================================================
  // INIT
  // ============================================================
  if (!window.DB) {
    document.getElementById('app').innerHTML = `
      <div class="loading-wrapper">
        <p style="color:#b00;text-align:center;max-width:420px">
          No se pudo inicializar Firebase.<br>
          Revisa <code>js/data.js</code> y la consola del navegador.
        </p>
      </div>
    `;
    return;
  }
  DB.onReady(render);
})();
