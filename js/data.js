(function () {
  'use strict';

  // =====================================================================
  // CONFIGURACIÓN FIREBASE
  // =====================================================================
  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyB6K_7P6djvlzxZ11fn0Eo_O62DRzOgpeg',
    authDomain: 'agrocomercial-117d3.firebaseapp.com',
    projectId: 'agrocomercial-117d3',
    storageBucket: 'agrocomercial-117d3.firebasestorage.app',
    messagingSenderId: '259493417028',
    appId: '1:259493417028:web:5a5b450f136fcbf0c92c11'
  };

  // Email que al registrarse/ingresar queda automáticamente como admin.
  const ADMIN_EMAIL = 'antiquera96@gmail.com';

  // =====================================================================
  // INICIALIZACIÓN FIREBASE
  // =====================================================================
  if (!window.firebase) {
    console.error('[DB] Firebase SDK no está cargado. Revisa los <script> en index.html.');
    return;
  }

  if (!firebase.apps.length) {
    firebase.initializeApp(FIREBASE_CONFIG);
  }

  // Segunda instancia para crear vendedores sin cerrar la sesión del admin.
  let _secondaryApp = null;
  function getSecondaryApp() {
    if (!_secondaryApp) {
      _secondaryApp = firebase.initializeApp(FIREBASE_CONFIG, 'Secondary');
    }
    return _secondaryApp;
  }

  const auth = firebase.auth();
  const fdb = firebase.firestore();
  const storage = firebase.storage();

  // =====================================================================
  // CACHÉ EN MEMORIA (lecturas síncronas)
  // =====================================================================
  const _c = {
    users: [],
    clients: [],
    products: [],
    orders: [],
    libro: [],
    messages: [],
    sugerencias: [],
    fiados: [],
    // Papeleras por tipo (soft delete universal)
    orders_trash: [],
    products_trash: [],
    users_trash: [],
    libro_trash: [],
    messages_trash: [],
    sugerencias_trash: [],
    fiados_trash: []
  };

  let _session = null;     // { uid, email, role, name }
  let _ready = false;
  let _renderFn = null;
  let _renderTimer = null;
  let _unsubs = [];
  let _authUnsub = null;

  function triggerRender() {
    if (!_renderFn) return;
    clearTimeout(_renderTimer);
    _renderTimer = setTimeout(() => {
      try { _renderFn(); } catch (e) { console.error('[DB] render error', e); }
    }, 80);
  }

  function clearListeners() {
    _unsubs.forEach(u => { try { u(); } catch (e) {} });
    _unsubs = [];
  }

  function listenCollection(name, target, orderField, orderDir) {
    let q = fdb.collection(name);
    if (orderField) q = q.orderBy(orderField, orderDir || 'desc');
    const unsub = q.onSnapshot(snap => {
      target.length = 0;
      snap.forEach(doc => target.push({ id: doc.id, ...doc.data() }));
      triggerRender();
    }, err => console.error('[DB] listener error', name, err));
    _unsubs.push(unsub);
  }

  function setupListeners(role) {
    clearListeners();
    // Todos ven productos
    listenCollection('products', _c.products, 'updatedAt', 'desc');

    if (role === 'admin') {
      listenCollection('users', _c.users, 'createdAt', 'desc');
      listenCollection('clients', _c.clients, 'createdAt', 'desc');
      listenCollection('orders', _c.orders, 'createdAt', 'desc');
      listenCollection('libro', _c.libro, 'completedAt', 'desc');
      listenCollection('messages', _c.messages, 'createdAt', 'desc');
      listenCollection('sugerencias', _c.sugerencias, 'createdAt', 'desc');
      listenCollection('fiados', _c.fiados, 'createdAt', 'desc');
      // Papeleras (solo admin)
      listenCollection('orders_trash', _c.orders_trash, 'deletedAt', 'desc');
      listenCollection('products_trash', _c.products_trash, 'deletedAt', 'desc');
      listenCollection('users_trash', _c.users_trash, 'deletedAt', 'desc');
      listenCollection('libro_trash', _c.libro_trash, 'deletedAt', 'desc');
      listenCollection('messages_trash', _c.messages_trash, 'deletedAt', 'desc');
      listenCollection('sugerencias_trash', _c.sugerencias_trash, 'deletedAt', 'desc');
      listenCollection('fiados_trash', _c.fiados_trash, 'deletedAt', 'desc');
    } else if (role === 'vendedor') {
      listenCollection('orders', _c.orders, 'createdAt', 'desc');
      listenCollection('libro', _c.libro, 'completedAt', 'desc');
      listenCollection('messages', _c.messages, 'createdAt', 'desc');
      listenCollection('fiados', _c.fiados, 'createdAt', 'desc');
    } else if (role === 'cliente') {
      // Un cliente solo ve sus propios pedidos (se filtran al consultar)
      const unsub = fdb.collection('orders')
        .where('clienteId', '==', _session.uid)
        .onSnapshot(snap => {
          _c.orders.length = 0;
          snap.forEach(doc => _c.orders.push({ id: doc.id, ...doc.data() }));
          triggerRender();
        }, err => console.error('[DB] orders(cliente) error', err));
      _unsubs.push(unsub);
    }
  }

  // =====================================================================
  // HELPERS SOFT DELETE
  // Nada se borra nunca directo: todo pasa primero por <col>_trash.
  // =====================================================================
  async function _softDelete(col, id) {
    const srcRef = fdb.collection(col).doc(id);
    const snap = await srcRef.get();
    if (!snap.exists) return;
    const data = snap.data();
    await fdb.collection(col + '_trash').doc(id).set({
      ...data,
      _originalCollection: col,
      deletedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await srcRef.delete();
  }

  async function _restoreFromTrash(col, id) {
    const ref = fdb.collection(col + '_trash').doc(id);
    const snap = await ref.get();
    if (!snap.exists) return;
    const raw = snap.data();
    // Quitar campos internos de papelera antes de restaurar
    delete raw.deletedAt;
    delete raw._originalCollection;
    await fdb.collection(col).doc(id).set(raw);
    await ref.delete();
  }

  async function _permDelete(col, id) {
    await fdb.collection(col + '_trash').doc(id).delete();
  }

  async function _emptyTrashOf(col, cacheList) {
    // Procesa en lotes de 400 por seguridad (límite batch: 500).
    const items = cacheList.slice();
    while (items.length) {
      const chunk = items.splice(0, 400);
      const batch = fdb.batch();
      chunk.forEach(o => batch.delete(fdb.collection(col + '_trash').doc(o.id)));
      await batch.commit();
    }
  }

  // =====================================================================
  // AUTH STATE
  // =====================================================================
  async function resolveRole(user) {
    // 1) Si el email es el admin, auto-bootstrap.
    if (user.email && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
      const ref = fdb.collection('users').doc(user.uid);
      const snap = await ref.get();
      if (!snap.exists) {
        await ref.set({
          uid: user.uid,
          email: user.email,
          username: 'admin',
          role: 'admin',
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }
      return { role: 'admin', name: 'admin' };
    }

    // 2) Buscar en users (vendedor)
    const uSnap = await fdb.collection('users').doc(user.uid).get();
    if (uSnap.exists) {
      const d = uSnap.data();
      return { role: d.role || 'vendedor', name: d.username || user.email };
    }

    // 3) Buscar en clients
    const cSnap = await fdb.collection('clients').doc(user.uid).get();
    if (cSnap.exists) {
      const d = cSnap.data();
      return { role: 'cliente', name: `${d.nombre || ''} ${d.apellido || ''}`.trim() };
    }

    return null;
  }

  function initAuth() {
    if (_authUnsub) _authUnsub();
    _authUnsub = auth.onAuthStateChanged(async user => {
      if (!user) {
        _session = null;
        clearListeners();
        _ready = true;
        triggerRender();
        return;
      }
      try {
        const info = await resolveRole(user);
        if (!info) {
          // Usuario autenticado pero sin perfil en Firestore → cerrar sesión.
          console.warn('[DB] Usuario sin perfil Firestore, cerrando sesión.');
          await auth.signOut();
          return;
        }
        _session = {
          uid: user.uid,
          email: user.email,
          role: info.role,
          name: info.name
        };
        setupListeners(info.role);
        _ready = true;
        triggerRender();
      } catch (e) {
        console.error('[DB] resolveRole error', e);
        await auth.signOut();
      }
    });
  }

  // =====================================================================
  // API PÚBLICA
  // =====================================================================
  const DB = {
    // Para que app.js sepa cuándo empezar a renderizar.
    onReady(fn) {
      _renderFn = fn;
      if (_ready) triggerRender();
    },
    isReady() { return _ready; },

    // ---------- Session ----------
    getSession() { return _session; },
    async logout() {
      await auth.signOut();
    },

    // ---------- Auth ----------
    async login(email, password) {
      const cred = await auth.signInWithEmailAndPassword(email.trim(), password);
      return cred.user;
    },
    async registerClient(data) {
      const cred = await auth.createUserWithEmailAndPassword(data.email.trim(), data.password);
      const user = cred.user;
      await fdb.collection('clients').doc(user.uid).set({
        uid: user.uid,
        nombre: (data.nombre || '').trim(),
        apellido: (data.apellido || '').trim(),
        telefono: (data.telefono || '').trim(),
        email: data.email.trim(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      return user;
    },

    // ---------- Users (vendedores y admins) ----------
    getUsers() { return _c.users.slice(); },
    getVendedores() { return _c.users.filter(u => u.role === 'vendedor'); },
    getUsuariosInternos() {
      // Admins + vendedores, ordenados (admins primero).
      return _c.users
        .filter(u => u.role === 'admin' || u.role === 'vendedor')
        .sort((a, b) => {
          if (a.role !== b.role) return a.role === 'admin' ? -1 : 1;
          return (toMs(b.createdAt) || 0) - (toMs(a.createdAt) || 0);
        });
    },
    async addUsuarioInterno(email, password, username, role) {
      // role: 'vendedor' | 'admin'. Crear en una app secundaria para no desloguear al admin.
      const safeRole = role === 'admin' ? 'admin' : 'vendedor';
      const sec = getSecondaryApp();
      const secAuth = firebase.auth(sec);
      try {
        const cred = await secAuth.createUserWithEmailAndPassword(email.trim(), password);
        const uid = cred.user.uid;
        await fdb.collection('users').doc(uid).set({
          uid,
          email: email.trim(),
          username: (username || email.split('@')[0]).trim(),
          role: safeRole,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        await secAuth.signOut();
        return { id: uid, email: email.trim(), username, role: safeRole };
      } catch (e) {
        try { await secAuth.signOut(); } catch (_) {}
        throw e;
      }
    },
    // Compatibilidad con código antiguo.
    async addVendedor(email, password, username) {
      return this.addUsuarioInterno(email, password, username, 'vendedor');
    },
    async deleteVendedor(id) {
      // Soft delete: pasa a users_trash. El usuario de Auth sigue existiendo hasta
      // que se borre desde la consola, pero el perfil puede recuperarse.
      if (_session && _session.uid === id) {
        throw new Error('No puedes eliminar tu propia cuenta mientras estás conectado.');
      }
      await _softDelete('users', id);
    },

    // ---------- Clients ----------
    getClients() { return _c.clients.slice(); },
    findClientById(id) { return _c.clients.find(c => c.id === id) || null; },

    // ---------- Products ----------
    getProducts() {
      return _c.products.slice().sort((a, b) => (toMs(b.updatedAt) || 0) - (toMs(a.updatedAt) || 0));
    },
    getProduct(id) { return _c.products.find(p => p.id === id) || null; },
    async addProduct(data) {
      const now = firebase.firestore.FieldValue.serverTimestamp();
      const payload = {
        nombre: (data.nombre || '').trim(),
        imagen: data.imagen || '',
        precio: parseInt(data.precio, 10) || 0,
        precioDescuento: data.precioDescuento ? parseInt(data.precioDescuento, 10) : null,
        createdAt: now,
        updatedAt: now
      };
      const ref = await fdb.collection('products').add(payload);
      return { id: ref.id, ...payload };
    },
    async updateProduct(id, data) {
      const payload = {
        nombre: (data.nombre || '').trim(),
        imagen: data.imagen || '',
        precio: parseInt(data.precio, 10) || 0,
        precioDescuento: data.precioDescuento ? parseInt(data.precioDescuento, 10) : null,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      await fdb.collection('products').doc(id).update(payload);
      return { id, ...payload };
    },
    async deleteProduct(id) {
      await _softDelete('products', id);
    },
    // Subida de imagen a Storage y devuelve URL.
    async uploadProductImage(file) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `products/${Date.now()}_${safeName}`;
      const ref = storage.ref(path);
      await ref.put(file);
      return await ref.getDownloadURL();
    },

    // ---------- Orders ----------
    getOrders() {
      return _c.orders.slice().sort((a, b) => (toMs(b.createdAt) || 0) - (toMs(a.createdAt) || 0));
    },
    getPendingOrdersCount() {
      return _c.orders.filter(o => o.estado === 'pendiente').length;
    },
    async addOrder(data) {
      const payload = {
        clienteId: data.clienteId || null,
        clienteNombre: data.clienteNombre || '',
        items: data.items || [],
        total: data.total || 0,
        tipoEntrega: data.tipoEntrega,
        direccion: data.direccion || '',
        nombrePersona: data.nombrePersona || '',
        telefono: data.telefono || '',
        correo: data.correo || '',
        nota: data.nota || '',
        conFactura: !!data.conFactura,
        manual: !!data.manual,
        estado: 'pendiente',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      const ref = await fdb.collection('orders').add(payload);
      return { id: ref.id, ...payload };
    },
    async setOrderFactura(id, conFactura) {
      await fdb.collection('orders').doc(id).update({
        conFactura: !!conFactura,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    },
    async updateOrderStatus(id, estado) {
      if (estado === 'terminado') {
        // Mover a libro de registro atómicamente.
        const ref = fdb.collection('orders').doc(id);
        const snap = await ref.get();
        if (!snap.exists) return;
        const data = snap.data();
        await fdb.collection('libro').doc(id).set({
          ...data,
          estado: 'terminado',
          completedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        await ref.delete();
      } else {
        await fdb.collection('orders').doc(id).update({
          estado,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }
    },
    async deleteOrder(id) {
      await _softDelete('orders', id);
    },

    // ---------- Libro ----------
    getLibro() {
      return _c.libro.slice().sort((a, b) => (toMs(b.completedAt) || 0) - (toMs(a.completedAt) || 0));
    },
    getLibroCount() { return _c.libro.length; },
    async deleteLibroEntry(id) {
      await _softDelete('libro', id);
    },

    // ---------- Messages ----------
    getMessages() {
      return _c.messages.slice().sort((a, b) => (toMs(b.createdAt) || 0) - (toMs(a.createdAt) || 0));
    },
    getUnreadMessagesCount() {
      return _c.messages.filter(m => !m.leido).length;
    },
    async addMessage(data) {
      const payload = {
        fromId: data.fromId || (_session && _session.uid) || null,
        fromName: data.fromName || (_session && _session.name) || '',
        fromRole: data.fromRole || (_session && _session.role) || '',
        texto: data.texto,
        leido: false,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      const ref = await fdb.collection('messages').add(payload);
      return { id: ref.id, ...payload };
    },
    async markMessageRead(id) {
      await fdb.collection('messages').doc(id).update({ leido: true });
    },
    async deleteMessage(id) {
      await _softDelete('messages', id);
    },

    // ---------- Sugerencias ----------
    getSugerencias() {
      return _c.sugerencias.slice().sort((a, b) => (toMs(b.createdAt) || 0) - (toMs(a.createdAt) || 0));
    },
    getUnreadSugerenciasCount() {
      return _c.sugerencias.filter(s => !s.leido).length;
    },
    async addSugerencia(data) {
      const payload = {
        fromId: data.fromId || (_session && _session.uid) || null,
        fromName: data.fromName || (_session && _session.name) || '',
        texto: data.texto,
        leido: false,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      const ref = await fdb.collection('sugerencias').add(payload);
      return { id: ref.id, ...payload };
    },
    async markSugerenciaRead(id) {
      await fdb.collection('sugerencias').doc(id).update({ leido: true });
    },
    async deleteSugerencia(id) {
      await _softDelete('sugerencias', id);
    },

    // ---------- Fiados ----------
    getFiados() {
      return _c.fiados.slice().sort((a, b) => {
        if (a.pagado !== b.pagado) return a.pagado ? 1 : -1;
        return (toMs(b.createdAt) || 0) - (toMs(a.createdAt) || 0);
      });
    },
    async addFiado(data) {
      const payload = {
        nombre: (data.nombre || '').trim(),
        fechaFiado: data.fechaFiado,
        fechaLimite: data.fechaLimite || '',
        monto: parseInt(data.monto, 10) || 0,
        notas: data.notas || '',
        pagado: false,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      const ref = await fdb.collection('fiados').add(payload);
      return { id: ref.id, ...payload };
    },
    async markFiadoPaid(id) {
      await fdb.collection('fiados').doc(id).update({
        pagado: true,
        fechaPago: firebase.firestore.FieldValue.serverTimestamp()
      });
    },
    async deleteFiado(id) {
      await _softDelete('fiados', id);
    },

    // =================================================================
    // PAPELERA UNIVERSAL
    // Cualquier cosa eliminada puede recuperarse desde aquí.
    // =================================================================
    getTrashByType(type) {
      const list = _c[type + '_trash'];
      if (!list) return [];
      return list.slice().sort((a, b) => (toMs(b.deletedAt) || 0) - (toMs(a.deletedAt) || 0));
    },
    getTrashCountByType(type) {
      const list = _c[type + '_trash'];
      return list ? list.length : 0;
    },
    getTrashCount() {
      // Total global (sumatoria de todas las papeleras).
      return (
        _c.orders_trash.length +
        _c.products_trash.length +
        _c.users_trash.length +
        _c.libro_trash.length +
        _c.messages_trash.length +
        _c.sugerencias_trash.length +
        _c.fiados_trash.length
      );
    },
    // Compatibilidad: getTrash() = pedidos en papelera (API antigua).
    getTrash() {
      return this.getTrashByType('orders');
    },
    async restoreFromTrash(type, id) {
      await _restoreFromTrash(type, id);
    },
    async permanentDeleteFromTrash(type, id) {
      await _permDelete(type, id);
    },
    async emptyTrashOfType(type) {
      const list = _c[type + '_trash'];
      if (!list) return;
      await _emptyTrashOf(type, list);
    },
    async emptyAllTrash() {
      const types = ['orders', 'products', 'users', 'libro', 'messages', 'sugerencias', 'fiados'];
      for (const t of types) {
        await _emptyTrashOf(t, _c[t + '_trash']);
      }
    },
    // --- Aliases antiguos (para que no rompa si algo viejo los llama) ---
    async restoreOrder(id) { await _restoreFromTrash('orders', id); },
    async permanentDeleteOrder(id) { await _permDelete('orders', id); },
    async emptyTrash() { await _emptyTrashOf('orders', _c.orders_trash); }
  };

  // Utilidad: convierte Timestamp de Firestore (o number, o Date) a ms.
  function toMs(v) {
    if (!v) return 0;
    if (typeof v === 'number') return v;
    if (v instanceof Date) return v.getTime();
    if (v.toMillis) return v.toMillis();
    if (v.seconds != null) return v.seconds * 1000;
    return 0;
  }
  DB.toMs = toMs;

  window.DB = DB;
  initAuth();
})();
