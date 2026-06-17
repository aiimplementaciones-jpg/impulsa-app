// translations loaded globally via index.html script tag (translations is already available in the global scope)

// ==========================================================================
// 🔌 CONFIGURACIÓN DE CONEXIÓN A SUPABASE (Reemplazar con tus credenciales reales)
// ==========================================================================
const SUPABASE_URL = "https://qmhgmroeootlwrjfxjne.supabase.co"; // Escribe aquí la URL de tu proyecto de Supabase (ej: "https://xyz.supabase.co")
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtaGdtcm9lb290bHdyamZ4am5lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2NzM4MTgsImV4cCI6MjA5NjI0OTgxOH0.nz7zQNarfFao9QfBSYWX94mxg0mEvqjfPqXmh2d_4bI"; // Escribe aquí la clave anon pública de tu proyecto

let supabaseClient = null;
if (SUPABASE_URL && SUPABASE_ANON_KEY && typeof window.supabase !== 'undefined') {
  try {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (e) {
    console.error("Error al inicializar el SDK de Supabase: ", e);
  }
}

// ==========================================================================
// 💾 ABSTRACCIÓN DE ALMACENAMIENTO (Evita bloqueos de Tracking Prevention/CORS en file://)
// ==========================================================================
const Storage = {
  memoryStore: {},
  isAvailable() {
    try {
      localStorage.setItem('__test__', '1');
      localStorage.removeItem('__test__');
      return true;
    } catch (e) {
      return false;
    }
  },
  getItem(key) {
    if (this.isAvailable()) {
      try {
        return localStorage.getItem(key);
      } catch (e) {
        // Fallback a memoria
      }
    }
    return this.memoryStore[key] || null;
  },
  setItem(key, value) {
    if (this.isAvailable()) {
      try {
        localStorage.setItem(key, value);
        return;
      } catch (e) {
        // Fallback a memoria
      }
    }
    this.memoryStore[key] = value;
  }
};

// ==========================================================================
// 📦 GESTOR DE ESTADO CENTRAL (SaaS Multi-Tenant State Manager)
// ==========================================================================
const App = {
  State: {
    lang: 'es',
    theme: 'light',
    activePage: 'home',
    currentUser: null,  // Cuenta de Comercio logueada
    isSuperAdmin: false, // Logueado como Super Admin de la plataforma
    users: [],          // Base de datos de Comercios (Tenants)
    locations: [],      // Locales registrados
    leads: [],          // Reseñas negativas capturadas
    locationRequests: [], // Solicitudes de creación de sucursales
    messages: [],         // NUEVO: Mensajes del administrador
    proxyLogs: [],      // Logs del Servidor seguro /api/support
    visits: 0,          // Semilla global de visitas
    wompiConfig: {      // Configuración de Pasarela Wompi
      publicKey: Storage.getItem('wompi_public_key') || '',
      privateKey: Storage.getItem('wompi_private_key') || '',
      integritySecret: Storage.getItem('wompi_integrity_secret') || '',
      mode: 'sandbox' // 'sandbox' o 'production'
    }
  },

  // Configuración de planes dinámica (Se puebla EXCLUSIVAMENTE desde Supabase)
  plansConfig: {},

  // Límites de locales por plan (Se puebla EXCLUSIVAMENTE desde Supabase)
  PlanLimits: {},

  // Inicializar Base de Datos y Preferencias
  async init() {
    this.State.lang = Storage.getItem('impulsa_lang') || 'es';
    this.State.theme = Storage.getItem('impulsa_theme') || 'light';
    this.State.isSuperAdmin = Storage.getItem('impulsa_is_superadmin') === 'true';

    // 🔐 RESTAURAR SESIÓN ACTIVA (Persistencia)
    const activeUserId = Storage.getItem('impulsa_active_user');

    if (activeUserId) {
      // Si es el usuario de desarrollo o cualquier otro ID guardado, 
      // lo pre-cargamos para evitar que el router nos saque al Login mientras sincronizamos.
      if (activeUserId === 'admin_bypass') {
        this.State.isSuperAdmin = true;
        this.State.currentUser = null;
      } else {
        this.State.currentUser = { id: activeUserId, businessName: '...' };
      }
    }

    // 🔄 SINCRONIZACIÓN INICIAL OBLIGATORIA (Fuente de Verdad: Supabase)
    if (typeof supabaseClient !== 'undefined') {
      this.addLog('SYSTEM', '🔌 Conectando a la base de datos de Supabase en la nube...');
      await this.syncFromSupabase();
    } else {
      this.addLog('SYSTEM', '⚠️ Supabase no configurado o inaccesible.');
      this.State.users = [];
      this.State.locations = [];
      this.State.leads = [];
    }

    // 5. Configurar logs de consola del servidor seguros
    this.addLog('SYSTEM', 'Servidor seguro de IMPULSA levantado en el puerto 5000.');
    this.addLog('SYSTEM', 'Middleware /api/support listo para eludir restricciones de CORS.');

    // 6. Registrar Service Worker para PWA
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('service-worker.js')
          .then(reg => {
            this.addLog('SYSTEM', `[PWA] Service Worker registrado exitosamente (Scope: ${reg.scope})`);
            this.State.proxyLogs.push({
              timestamp: new Date().toLocaleTimeString(),
              type: 'SUCCESS',
              message: 'PWA: Service Worker activo. App lista para instalación nativa.'
            });
          })
          .catch(err => console.error('[PWA] Error al registrar Service Worker:', err));
      });
    }

    this.applyTheme();
    this.bindGlobalEvents();
    
    // Iniciar monitoreo de notificaciones (NUEVO)
    this.initNotificationSystem();

    // Iniciar Router dinámico
    this.handleRouting();
    window.addEventListener('hashchange', () => this.handleRouting());
  },

  // ==========================================================================
  // 🔔 SISTEMA DE NOTIFICACIONES DE ESCRITORIO (NUEVO)
  // ==========================================================================
  initNotificationSystem() {
    this.lastMessageCount = 0;
    // La solicitud de permiso se ha movido a una acción de usuario para cumplir con las políticas del navegador
    
    // Chequear nuevos mensajes cada 30 segundos si la app está abierta
    setInterval(() => {
      this.checkForNewMessages();
    }, 30000);
  },

  async requestNotificationPermission() {
    if ("Notification" in window) {
      if (Notification.permission !== "granted" && Notification.permission !== "denied") {
        await Notification.requestPermission();
      }
    }
  },

  async checkForNewMessages() {
    if (!supabaseClient) return;

    // Consultar el conteo total de mensajes
    const { count, error } = await supabaseClient
      .from('messages')
      .select('*', { count: 'exact', head: true });

    if (!error && count !== null) {
      // Si el número de mensajes aumentó, es que alguien escribió
      if (this.lastMessageCount > 0 && count > this.lastMessageCount) {
        // Obtener el último mensaje para mostrar en la notificación
        const { data: latestMsg } = await supabaseClient
          .from('messages')
          .select('content, sender')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (latestMsg && latestMsg.sender !== 'Soporte IMPULSA' && latestMsg.sender !== 'Admin') {
          this.notifyNewMessage(latestMsg.sender, latestMsg.content);
          // Sincronizar para actualizar la UI si es necesario
          this.syncFromSupabase();
        }
      }
      this.lastMessageCount = count;
    }
  },

  notifyNewMessage(sender, text) {
    // 1. Sonido de alerta
    try {
      const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3');
      audio.play();
    } catch (e) {
      console.warn("No se pudo reproducir el sonido de notificación.");
    }

    // 2. Notificación de Escritorio
    if (Notification.permission === "granted") {
      const notification = new Notification(`🚀 IMPULSA: Nuevo mensaje de ${sender}`, {
        body: text.length > 60 ? text.substring(0, 60) + '...' : text,
        icon: 'https://qmhgmroeootlwrjfxjne.supabase.co/storage/v1/object/public/logos/Impulsa%20Logo.png'
      });

      notification.onclick = () => {
        window.focus();
        if (this.State.isSuperAdmin) {
          window.location.hash = '#admin';
        } else {
          window.location.hash = '#dashboard';
        }
      };
    }
  },

  // Sincronizar toda la data desde Supabase
  async syncFromSupabase() {
    try {
      // 0. Asegurar estado de Super Admin desde Storage
      if (Storage.getItem('impulsa_is_superadmin') === 'true') {
        this.State.isSuperAdmin = true;
      }

      // 1. Obtener configuración de planes dinámicos (NUEVO)
      const { data: dbPlans, error: plansErr } = await supabaseClient.from('plans').select('*');
      if (!plansErr && dbPlans && dbPlans.length > 0) {
        this.plansConfig = {}; // LIMPIEZA TOTAL antes de poblar
        dbPlans.forEach(p => {
          this.plansConfig[p.id] = {
            name: p.name,
            price: parseFloat(p.price),
            limit: p.location_limit === null ? Infinity : p.location_limit,
            features: p.features || []
          };
          this.PlanLimits[p.id] = this.plansConfig[p.id].limit;
        });
      }

      // 1b. Obtener configuración global de Wompi (NUEVO)
      const { data: globalConf, error: globalErr } = await supabaseClient
        .from('global_config')
        .select('*')
        .eq('id', 'wompi')
        .single();
      
      if (!globalErr && globalConf) {
        this.State.wompiConfig = {
          ...this.State.wompiConfig,
          ...globalConf.data
        };
        this.addLog('SYSTEM', 'Configuración de Wompi sincronizada desde la nube.');
      }

      // 1c. Obtener la sesión activa de Supabase
      const { data: { session } } = await supabaseClient.auth.getSession();
      let activeUserId = session?.user?.id;

      // Si no hay sesión real pero hay bypass, usamos el ID de Mauro o el admin_bypass
      if (!activeUserId && this.State.currentUser) {
        activeUserId = this.State.currentUser.id;
      } else if (!activeUserId && this.State.isSuperAdmin) {
        activeUserId = Storage.getItem('impulsa_active_user');
      }

      if (activeUserId && activeUserId !== 'admin_bypass') {
        this.addLog('SYSTEM', `Sincronizando datos para el usuario: ${activeUserId}`);

        // Obtener el perfil del usuario actual (tenant)
        const { data: profile, error: profileErr } = await supabaseClient
          .from('profiles')
          .select('*')
          .eq('id', activeUserId)
          .single();

        if (profile) {
          this.State.currentUser = {
            id: profile.id,
            businessName: profile.business_name,
            fullName: profile.full_name || '',
            email: profile.email || (session?.user?.email || 'mauro@prueba.com'),
            whatsapp: profile.whatsapp || '',
            address: profile.address || '',
            city: profile.city || '',
            plan: profile.plan || 'free',
            logo: profile.logo || '🏪',
            accentColor: profile.accent_color || '#6366f1',
            bgColor: profile.bg_color || '#ffffff',
            title: profile.portal_title || (profile.business_name ? `Opiniones de ${profile.business_name}` : 'Portal de Opiniones'),
            qrAccentColor: profile.qr_accent_color || '#6366f1',
            qrBgColor: profile.qr_bg_color || '#ffffff',
            qrCustomImage: profile.qr_custom_image || null,
            qrFooterText: profile.qr_footer_text || '¡Tu opinión nos ayuda a crecer!',
            subscriptionDate: profile.subscription_date,
            subscriptionExpiry: profile.subscription_expiry
          };
        } else if (profileErr) {
          this.addLog('SYSTEM', `Error obteniendo perfil: ${profileErr.message}`);
        }
      } else {
        this.State.currentUser = null;
      }

      // 2. Obtener los locales (siempre de la tabla 'locations')
      let queryLoc = supabaseClient.from('locations').select('*');
      if (!this.State.isSuperAdmin && this.State.currentUser) {
        queryLoc = queryLoc.eq('tenant_id', this.State.currentUser.id);
      }
      const { data: dbLocs } = await queryLoc;
      this.State.locations = (dbLocs || []).map(l => ({
        id: l.id,
        userId: l.tenant_id,
        name: l.name,
        address: l.address,
        mapsUrl: l.maps_url || '',
        status: l.status
      }));

      // 4. Obtener todos los tenants si es Súper Administrador o poblar con el actual
      if (this.State.isSuperAdmin) {
        const { data: dbProfiles, error: profilesErr } = await supabaseClient.from('profiles').select('*');
        if (profilesErr) {
          this.addLog('SYSTEM', `Error obteniendo base de datos de comercios: ${profilesErr.message}`);
          console.error("Error fetching profiles:", profilesErr);
        }
        this.State.users = (dbProfiles || []).map(p => ({
          id: p.id,
          businessName: p.business_name,
          fullName: p.full_name,
          email: p.email,
          whatsapp: p.whatsapp,
          address: p.address,
          city: p.city,
          plan: p.plan,
          logo: p.logo,
          accentColor: p.accent_color,
          bgColor: p.bg_color,
          title: p.portal_title || `Opiniones de ${p.business_name}`,
          lastPaymentAmount: p.last_payment_amount,
          subscriptionPeriod: p.subscription_period,
          subscriptionDate: p.subscription_date,
          subscriptionExpiry: p.subscription_expiry
        }));
      } else if (this.State.currentUser) {
        // En este punto, 'profile' ya contiene los datos del usuario actual (paso 1)
        // Pero necesitamos asegurarnos de que profile esté definido
        const { data: p } = await supabaseClient.from('profiles').select('*').eq('id', this.State.currentUser.id).single();
        if (p) {
          this.State.users = [{
            id: p.id,
            businessName: p.business_name,
            fullName: p.full_name,
            email: p.email,
            whatsapp: p.whatsapp,
            address: p.address,
            city: p.city,
            plan: p.plan,
            logo: p.logo,
            accentColor: p.accent_color,
            bgColor: p.bg_color,
            title: p.portal_title || `Opiniones de ${p.business_name}`,
            lastPaymentAmount: p.last_payment_amount,
            subscriptionPeriod: p.subscription_period,
            subscriptionDate: p.subscription_date,
            subscriptionExpiry: p.subscription_expiry
          }];
        }
      }

      // 3. Obtener los feedbacks (leads)
      let queryLeads = supabaseClient.from('leads').select('*');
      
      // Si NO es Super Admin, filtramos por el tenant actual. 
      // Si ES Super Admin, traemos TODO.
      if (!this.State.isSuperAdmin && this.State.currentUser) {
        queryLeads = queryLeads.eq('tenant_id', this.State.currentUser.id);
      }
      
      const { data: dbLeads } = await queryLeads;
      this.State.leads = (dbLeads || [])
        .map(f => ({
          id: f.id,
          userId: f.tenant_id,
          date: f.created_at,
          locationId: f.location_id,
          locationName: this.State.locations.find(l => l.id === f.location_id)?.name || 'Sucursal Desconocida',
          businessName: this.State.users.find(u => u.id === f.tenant_id)?.businessName || 'Comercio',
          clientName: f.client_name,
          clientPhone: f.client_phone,
          rating: f.rating,
          comment: f.comment || ''
        }));

      this.addLog('SYSTEM', `Sincronización con Supabase exitosa: ${this.State.locations.length} sucursales y ${this.State.leads.length} casos cargados.`);

      // 5. Obtener solicitudes de sucursales (Location Requests)
      let queryReq = supabaseClient.from('location_requests').select('*');
      if (!this.State.isSuperAdmin && this.State.currentUser) {
        queryReq = queryReq.eq('tenant_id', this.State.currentUser.id);
      }
      const { data: dbReqs } = await queryReq;
      this.State.locationRequests = (dbReqs || []).map(r => ({
        id: r.id,
        tenantId: r.tenant_id,
        businessName: r.business_name,
        contactName: r.contact_name,
        contactEmail: r.contact_email,
        contactPhone: r.contact_phone,
        locName: r.loc_name,
        locAddress: r.loc_address,
        locAccentColor: r.loc_accent_color,
        locLogo: r.loc_logo,
        status: r.status,
        date: r.created_at
      }));

      // 6. Obtener Mensajes (NUEVO)
      try {
        let queryMsg = supabaseClient.from('messages').select('*').order('created_at', { ascending: false });
        if (this.State.currentUser && !this.State.isSuperAdmin) {
          queryMsg = queryMsg.eq('tenant_id', this.State.currentUser.id);
        }
        const { data: dbMsgs, error: msgErr } = await queryMsg;
        
        if (!msgErr && dbMsgs) {
          this.State.messages = dbMsgs.map(m => ({
            id: m.id,
            tenantId: m.tenant_id,
            content: m.content,
            sender: m.sender,
            isRead: m.is_read,
            date: m.created_at
          }));
        } else {
          this.State.messages = [];
          if (msgErr && msgErr.code !== 'PGRST204' && msgErr.code !== '42P01') {
            console.warn("Aviso: No se pudieron cargar mensajes:", msgErr.message);
          }
        }
      } catch (e) {
        this.State.messages = [];
      }

      // Refrescar la página actual para mostrar los datos recién cargados (especialmente planes)
      this.addLog('SYSTEM', `Sincronización con Supabase exitosa: ${this.State.locations.length} sucursales, ${this.State.leads.length} casos y ${this.State.messages.length} mensajes cargados.`);
      if (this.State.activePage) {
        this.renderPageContent(this.State.activePage);
      }
    } catch (err) {
      this.addLog('SYSTEM', `Error de sincronización con Supabase: ${err.message}`);
    }
  },
  saveLocations() {
    Storage.setItem('impulsa_locations', JSON.stringify(this.State.locations));
  },
  saveLeads() {
    Storage.setItem('impulsa_leads', JSON.stringify(this.State.leads));
  },

  // Añadir registros de logs de la API proxy
  addLog(type, message) {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = { timestamp, type, message };
    this.State.proxyLogs.push(logEntry);
    
    if (this.State.proxyLogs.length > 50) this.State.proxyLogs.shift();
    
    const terminalBody = document.getElementById('terminal-body');
    if (terminalBody) {
      const lineClass = type === 'POST' ? 'method-post' : type === 'GET' ? 'method-get' : type === 'SYSTEM' ? 'system' : 'success';
      const logLine = document.createElement('div');
      logLine.className = `terminal-line ${lineClass}`;
      logLine.innerHTML = `[${timestamp}] [${type}] ${message}`;
      terminalBody.appendChild(logLine);
      terminalBody.scrollTop = terminalBody.scrollHeight;
    }
  },

  // ==========================================================================
  // 🧭 ENRUTADOR DINÁMICO DE PÁGINAS Y MENÚS (SPA Router)
  // ==========================================================================
  handleRouting() {
    const hash = window.location.hash || '#home';
    const urlSearchParams = new URLSearchParams(window.location.search);
    
    // Si detectamos el regreso de Wompi por parámetro de búsqueda (evitando el # en la redirección)
    if (urlSearchParams.has('pay_res')) {
      // Limpiar el parámetro de la URL para que no se repita el proceso al refrescar
      const newUrl = window.location.origin + window.location.pathname + '#billing-response' + window.location.search;
      window.history.replaceState({}, document.title, newUrl);
    }

    // Limpieza de estilos del portal de opiniones del cliente
    document.body.classList.remove('portal-mode');
    const header = document.querySelector('.app-header');
    const sidebar = document.querySelector('.sidebar');
    const bottomNav = document.querySelector('.bottom-nav');
    const chatBubble = document.getElementById('chat-bubble');

    if (header) header.style.display = '';
    if (sidebar) sidebar.style.display = '';
    if (bottomNav) bottomNav.style.display = '';
    if (chatBubble) chatBubble.style.display = '';

    // Manejo de la ruta del Portal de Calificación del Cliente
    if (hash.startsWith('#portal')) {
      document.body.classList.add('portal-mode');
      if (header) header.style.display = 'none';
      if (sidebar) sidebar.style.display = 'none';
      if (bottomNav) bottomNav.style.display = 'none';
      if (chatBubble) chatBubble.style.display = 'none';
      
      const urlParams = new URLSearchParams(hash.substring(hash.indexOf('?')));
      const locationId = urlParams.get('id');
      const prospectId = urlParams.get('prospect');
      this.renderOpinionPortal(locationId, prospectId);
      return;
    }

    // Manejo de la ruta de Respuesta de Pago Wompi
    if (hash.startsWith('#billing-response')) {
      // Extraer parámetros: Primero del hash (común en SPAs) y luego del search (por si acaso)
      const hashParams = new URLSearchParams(hash.includes('?') ? hash.substring(hash.indexOf('?')) : '');
      const searchParams = new URLSearchParams(window.location.search);
      
      // Combinar parámetros (prioridad al hash que es lo que Wompi debería devolver si el redirect_url tenía #)
      const combinedParams = new URLSearchParams();
      [searchParams, hashParams].forEach(p => {
        for (const [key, value] of p.entries()) combinedParams.set(key, value);
      });

      this.renderBillingResponse(pageContainer || document.getElementById('app-view'), combinedParams);
      return;
    }

    const pageName = hash.replace('#', '').split('?')[0];
    this.State.activePage = pageName;

    // Actualizar barras de navegación dinámica antes de renderizar
    this.updateNavigationUI();

    // Renderizar la vista correspondiente
    this.renderPageContent(pageName);
  },

  // Actualizar Menús de Navegación según el Estado de Autenticación
  updateNavigationUI() {
    const sidebarNav = document.querySelector('.sidebar-nav');
    const bottomNav = document.querySelector('.bottom-nav');
    
    if (!sidebarNav || !bottomNav) return;

    let navHTML = '';
    let bottomHTML = '';

    if (this.State.isSuperAdmin) {
      // 🛡️ MENÚS EXCLUSIVOS PARA EL SUPER ADMINISTRADOR
      navHTML = `
        <button class="nav-item ${this.State.activePage === 'admin' ? 'active' : ''}" data-page="admin">
          <i data-lucide="shield-check"></i>
          <span data-i18n="nav_admin">Panel Admin</span>
        </button>
        <button class="nav-item ${this.State.activePage === 'support' ? 'active' : ''}" data-page="support">
          <i data-lucide="server"></i>
          <span data-i18n="nav_support">Secure Proxy</span>
        </button>
        <button class="nav-item" id="sidebar-logout-btn">
          <i data-lucide="log-out" style="color:var(--color-danger)"></i>
          <span data-i18n="logout" style="color:var(--color-danger)">Cerrar Sesión</span>
        </button>
      `;
      bottomHTML = `
        <button class="nav-item ${this.State.activePage === 'admin' ? 'active' : ''}" data-page="admin">
          <i data-lucide="shield-check"></i>
          <span data-i18n="nav_admin">Admin</span>
        </button>
        <button class="nav-item" id="bottom-logout-btn">
          <i data-lucide="log-out" style="color:var(--color-danger)"></i>
          <span data-i18n="logout" style="color:var(--color-danger)">Salir</span>
        </button>
      `;
    } else if (this.State.currentUser) {
      // 💼 MENÚS EXCLUSIVOS PARA EL CLIENTE COMERCIAL (Logueado)
      navHTML = `
        <button class="nav-item ${this.State.activePage === 'dashboard' ? 'active' : ''}" data-page="dashboard">
          <i data-lucide="layout-dashboard"></i>
          <span data-i18n="nav_dashboard">Mi Panel</span>
        </button>
        <button class="nav-item ${this.State.activePage === 'locations' ? 'active' : ''}" data-page="locations">
          <i data-lucide="map-pin"></i>
          <span data-i18n="nav_locations">Mis Sucursales</span>
        </button>
        <button class="nav-item ${this.State.activePage === 'statistics' ? 'active' : ''}" data-page="statistics">
          <i data-lucide="bar-chart-3"></i>
          <span data-i18n="nav_statistics">Mis Reportes</span>
        </button>
        <button class="nav-item ${this.State.activePage === 'billing' ? 'active' : ''}" data-page="billing">
          <i data-lucide="credit-card"></i>
          <span data-i18n="nav_billing">Mi Suscripción</span>
        </button>
        <button class="nav-item ${this.State.activePage === 'support' ? 'active' : ''}" data-page="support">
          <i data-lucide="help-circle"></i>
          <span data-i18n="nav_support">Soporte</span>
        </button>
        <button class="nav-item" id="sidebar-logout-btn">
          <i data-lucide="log-out" style="color:var(--color-danger)"></i>
          <span data-i18n="logout" style="color:var(--color-danger)">Cerrar Sesión</span>
        </button>
      `;
      bottomHTML = `
        <button class="nav-item ${this.State.activePage === 'dashboard' ? 'active' : ''}" data-page="dashboard">
          <i data-lucide="layout-dashboard"></i>
          <span data-i18n="nav_dashboard">Panel</span>
        </button>
        <button class="nav-item ${this.State.activePage === 'locations' ? 'active' : ''}" data-page="locations">
          <i data-lucide="map-pin"></i>
          <span data-i18n="nav_locations">Sucursales</span>
        </button>
        <button class="nav-item ${this.State.activePage === 'statistics' ? 'active' : ''}" data-page="statistics">
          <i data-lucide="bar-chart-3"></i>
          <span data-i18n="nav_statistics">Reportes</span>
        </button>
        <button class="nav-item ${this.State.activePage === 'billing' ? 'active' : ''}" data-page="billing">
          <i data-lucide="credit-card"></i>
          <span data-i18n="nav_billing">Planes</span>
        </button>
        <button class="nav-item" id="bottom-logout-btn">
          <i data-lucide="log-out" style="color:var(--color-danger)"></i>
          <span data-i18n="logout">Salir</span>
        </button>
      `;
    } else {
      // 🌐 MENÚS PARA VISITANTES ANÓNIMOS (Página de Ventas)
      navHTML = `
        <button class="nav-item ${this.State.activePage === 'home' ? 'active' : ''}" data-page="home">
          <i data-lucide="home"></i>
          <span data-i18n="nav_home">Inicio</span>
        </button>
        <button class="nav-item ${this.State.activePage === 'login' ? 'active' : ''}" data-page="login">
          <i data-lucide="log-in"></i>
          <span data-i18n="login">Iniciar Sesión</span>
        </button>
        <button class="nav-item ${this.State.activePage === 'register' ? 'active' : ''}" data-page="register">
          <i data-lucide="user-plus"></i>
          <span data-i18n="register">Crear Cuenta</span>
        </button>
        <button class="nav-item ${this.State.activePage === 'admin' ? 'active' : ''}" data-page="admin" style="margin-top:auto; border-top:1px dashed var(--border-color); padding-top:16px;">
          <i data-lucide="shield-check"></i>
          <span data-i18n="nav_admin">Súper Admin</span>
        </button>
      `;
      bottomHTML = `
        <button class="nav-item ${this.State.activePage === 'home' ? 'active' : ''}" data-page="home">
          <i data-lucide="home"></i>
          <span data-i18n="nav_home">Inicio</span>
        </button>
        <button class="nav-item ${this.State.activePage === 'login' ? 'active' : ''}" data-page="login">
          <i data-lucide="log-in"></i>
          <span data-i18n="login">Entrar</span>
        </button>
        <button class="nav-item ${this.State.activePage === 'register' ? 'active' : ''}" data-page="register">
          <i data-lucide="user-plus"></i>
          <span data-i18n="register">Registrar</span>
        </button>
        <button class="nav-item ${this.State.activePage === 'admin' ? 'active' : ''}" data-page="admin">
          <i data-lucide="shield-check"></i>
          <span data-i18n="nav_admin">Admin</span>
        </button>
      `;
    }

    sidebarNav.innerHTML = navHTML;
    bottomNav.innerHTML = bottomHTML;

    // Vincular clics de navegación dinámicos
    document.querySelectorAll('.nav-item[data-page]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        window.location.hash = `#${el.getAttribute('data-page')}`;
      });
    });

    // Vincular botones de cerrar sesión
    const sLogout = document.getElementById('sidebar-logout-btn');
    const bLogout = document.getElementById('bottom-logout-btn');
    if (sLogout) sLogout.addEventListener('click', () => this.handleLogout());
    if (bLogout) bLogout.addEventListener('click', () => this.handleLogout());

    this.translateInterface();
  },

  renderPageContent(pageName) {
    const viewContainer = document.getElementById('app-view');
    if (!viewContainer) return;

    this.addLog('GET', `Navegando a: /${pageName}`);

    // Proteger páginas privadas de clientes
    const clientPrivatePages = ['dashboard', 'locations', 'statistics', 'billing'];
    if (clientPrivatePages.includes(pageName) && !this.State.currentUser) {
      this.addLog('SYSTEM', 'Acceso denegado. Redirigiendo a /login.');
      window.location.hash = '#login';
      return;
    }

    switch (pageName) {
      case 'home':
        this.renderHome(viewContainer);
        break;
      case 'login':
      case 'register':
        this.renderAuth(viewContainer, pageName);
        break;
      case 'dashboard':
        this.renderDashboard(viewContainer);
        break;
      case 'locations':
        this.renderLocations(viewContainer);
        break;
      case 'statistics':
        this.renderStatistics(viewContainer);
        break;
      case 'billing':
        this.renderBilling(viewContainer);
        break;
      case 'admin':
        this.renderAdminDashboard(viewContainer);
        break;
      case 'support':
        this.renderSupportPage(viewContainer);
        break;
      default:
        viewContainer.innerHTML = `<div style="padding:40px; text-align:center;"><h2>Page Not Found</h2></div>`;
    }

    this.translateInterface();
    window.scrollTo(0, 0);
  },

  // ==========================================================================
  // 🌐 PÁGINA INICIAL / DE VENTAS (LandingPage)
  // ==========================================================================
  renderHome(container) {
    container.innerHTML = `
      <!-- Hero Section de Ventas -->
      <section class="landing-hero" style="padding-top: 20px;">
        <div style="background-color:rgba(0,123,255,0.1); padding:6px 14px; border-radius:100px; font-size:0.75rem; font-weight:700; color:var(--color-brand); margin-bottom:16px; text-transform:uppercase; letter-spacing:0.05em;">
          🚀 CONVIERTE CLIENTES EN RESEÑAS DE 5 ESTRELLAS
        </div>
        
        <!-- Simulador de Celular Realista -->
        <div class="phone-simulator-container" style="margin-bottom: 40px; perspective: 1000px; width: 100%; display: flex; justify-content: center;">
          <div class="phone-frame" style="width: 100%; max-width: 280px; height: 560px; background: #1a1a1a; border-radius: 40px; border: 8px solid #333; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); position: relative; overflow: hidden;">
            <div class="phone-notch" style="width: 120px; height: 25px; background: #333; position: absolute; top: 0; left: 50%; transform: translateX(-50%); border-bottom-left-radius: 15px; border-bottom-right-radius: 15px; z-index: 10;"></div>
            
            <div class="phone-screen" style="width: 100%; height: 100%; background: var(--bg-primary); padding: 40px 20px; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 20px;">
              <div style="font-size: 3rem;">🍔</div>
              <h3 style="font-size: 1.2rem; margin: 0; color: var(--text-primary);">Burger Master Premium</h3>
              <p style="font-size: 0.75rem; color: var(--text-secondary); margin: 0;">¿Cómo fue tu experiencia hoy?</p>
              
              <div style="display: flex; gap: 6px; margin: 10px 0;">
                ${Array.from({ length: 5 }).map(() => `<i data-lucide="star" style="width: 24px; height: 24px; color: #FFD700; fill: #FFD700;"></i>`).join('')}
              </div>
              
              <div style="background: white; padding: 12px; border-radius: 12px; border: 1px solid #eee; margin-top: 10px;">
                <i data-lucide="qr-code" style="width: 120px; height: 120px; color: #333;"></i>
                <p style="font-size: 0.65rem; color: #666; margin-top: 8px; font-weight: 700;">ESCANEA PARA CALIFICAR</p>
              </div>

              <div style="margin-top: auto; width: 100%; background: var(--color-brand); color: white; padding: 10px; border-radius: 8px; font-size: 0.8rem; font-weight: 700;">
                ENVIAR OPINIÓN
              </div>
            </div>
          </div>
        </div>

        <h1 data-i18n="land_hero_title">Aumenta tus opiniones de 5 estrellas en Google Maps de forma inteligente</h1>
        <p data-i18n="land_hero_desc">IMPULSA es la plataforma SaaS definitiva para comercios. Obtén más reseñas positivas públicamente y mitiga las críticas negativas en canales internos antes de que afecten tu reputación.</p>
        <div class="landing-hero-ctas">
          <a href="#register" class="btn btn-primary" data-i18n="land_cta_register">🚀 Comenzar Gratis Ahora</a>
          <a href="#login" class="btn btn-secondary" data-i18n="land_cta_login">Ingresar a mi Consola</a>
        </div>
      </section>

      <!-- Simulador Interactivo del Filtro Estratégico -->
      <div class="card" style="border-color:var(--color-brand); background:linear-gradient(135deg, rgba(0, 123, 255, 0.03), transparent);">
        <h3 class="card-title" style="justify-content:center; font-size:1.2rem;">
          🚀 <i data-lucide="sparkles" style="color:var(--color-accent)"></i> Pruébalo tú mismo: Filtro de Estrellas en Vivo
        </h3>
        <p style="font-size:0.85rem; text-align:center; color:var(--text-secondary); margin-bottom:20px;">
          Califica nuestra plataforma como si fueras un cliente final y mira la redirección inteligente.
        </p>
        
        <div class="stars-container" id="landing-demo-stars" style="margin: 12px 0;">
          ${Array.from({ length: 5 }).map((_, i) => `
            <button class="star-btn demo-star" data-index="${i + 1}" style="padding:2px;">
              <i data-lucide="star" style="width:36px; height:36px;"></i>
            </button>
          `).join('')}
        </div>
        
        <div id="landing-demo-result" style="display:none; text-align:center; padding:16px; border-radius:var(--radius-md); background-color:var(--bg-primary); border:1px solid var(--border-color); animation:slideUp 0.3s ease;">
          <!-- Cargado por JS -->
        </div>
      </div>

      <!-- Guía Visual y Cómo Funciona -->
      <section style="margin-top: 60px;">
        <div class="section-title-graphic">
          <h2 data-i18n="land_how_it_works_title">¿Cómo funciona IMPULSA?</h2>
          <p data-i18n="land_how_it_works_desc">Nuestro sistema filtra automáticamente la experiencia del cliente para maximizar tu visibilidad pública y proteger tu marca en privado.</p>
        </div>

        <div class="infographic-container">
          <img src="Recursos/Gestión_de_Reputación_Inteligente.png" alt="Infografía IMPULSA" class="infographic-img">
        </div>

        <div class="section-title-graphic">
          <h2 data-i18n="land_video_title">Mira IMPULSA en acción</h2>
        </div>

        <div class="video-container">
          <video controls class="video-player" poster="Recursos/Gestión_de_Reputación_Inteligente.png">
            <source src="Recursos/IMPULSA__Reputación.mp4" type="video/mp4">
            Tu navegador no soporta el elemento de video.
          </video>
        </div>
      </section>

      <!-- Ventajas y Funcionalidades -->
      <section style="margin-top: 40px;">
        <h2 style="text-align:center; font-size:1.5rem; margin-bottom:8px;" data-i18n="land_features_title">¿Por qué los comercios prefieren IMPULSA?</h2>
        <div class="features-grid">
          
          <div class="feature-item-card">
            <div class="feature-icon-wrapper"><i data-lucide="star"></i></div>
            <h3 data-i18n="land_feat1_title">Filtro de Excelencia (Solo 5⭐)</h3>
            <p data-i18n="land_feat1_desc">Redirige exclusivamente calificaciones de 5 estrellas a Google Maps. Las de 1-4 estrellas van a tu buzón interno para resolverlas en privado.</p>
          </div>

          <div class="feature-item-card">
            <div class="feature-icon-wrapper"><i data-lucide="qr-code"></i></div>
            <h3 data-i18n="land_feat2_title">Habladores de Mesa y Códigos QR HD</h3>
            <p data-i18n="land_feat2_desc">Genera códigos QR listos para imprimir en alta resolución y colocarlos en puntos estratégicos de tus locales.</p>
          </div>

          <div class="feature-item-card">
            <div class="feature-icon-wrapper"><i data-lucide="phone-call"></i></div>
            <h3 data-i18n="land_feat3_title">Mitigación de Crisis con WhatsApp</h3>
            <p data-i18n="land_feat3_desc">Recibe los comentarios de clientes insatisfechos en tu panel y contáctalos de inmediato con disculpas automáticas por WhatsApp.</p>
          </div>

          <div class="feature-item-card">
            <div class="feature-icon-wrapper"><i data-lucide="line-chart"></i></div>
            <h3 data-i18n="land_feat4_title">Analítica y Exportes de Excel</h3>
            <p data-i18n="land_feat4_desc">Monitorea la conversión, visitas y promedios por sucursal. Exporta reportes en formato CSV.</p>
          </div>

        </div>
      </section>

      <!-- Tabla de Precios -->
      <section style="margin-top: 48px; margin-bottom: 24px; width: 100%; display: flex; flex-direction: column; align-items: center;">
        <h2 style="text-align:center; font-size:1.5rem; margin-bottom:8px;" data-i18n="land_pricing_title">Planes diseñados para cada etapa de tu negocio</h2>
        <p style="text-align:center; color:var(--text-secondary); font-size:0.9rem; margin-bottom:30px; max-width: 600px;" data-i18n="land_pricing_desc">Comienza sin costo o expande tus sucursales con nuestros planes flexibles.</p>
        
        <div class="pricing-tabs" style="margin-top: 20px; width: 100%; display: flex; justify-content: center; gap: 20px; flex-wrap: wrap; padding: 0 20px;">
          ${Object.entries(this.plansConfig).map(([key, plan]) => `
            <div class="pricing-card ${key === 'pro' ? 'featured' : ''}" style="flex: 1; min-width: 280px; max-width: 350px; margin: 0;">
              ${key === 'pro' ? `<span class="pricing-featured-badge">Más Popular</span>` : ''}
              <div class="pricing-header">
                <h3>${plan.name}</h3>
                <span style="font-size: 0.8rem; color: var(--text-secondary);">
                  ${plan.limit === Infinity ? 'Sucursales ilimitadas' : `Límite: ${plan.limit} ${plan.limit === 1 ? 'sucursal' : 'sucursales'}`}
                </span>
              </div>
              <div class="pricing-price" style="font-size: 1.8rem; margin: 20px 0;">
                ${plan.price === 0 ? 'Gratis' : `${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(plan.price)} <span style="font-size: 0.9rem; font-weight: 400; color: var(--text-secondary);">/ mes</span>`}
              </div>
              <ul class="pricing-features-list" style="text-align: left; margin-bottom: 25px;">
                ${plan.features.map(f => `<li style="margin-bottom: 8px; font-size: 0.85rem;"><i data-lucide="check" style="width: 16px; height: 16px; color: var(--color-success); margin-right: 8px;"></i> <span>${f}</span></li>`).join('')}
              </ul>
              <a href="#register" class="btn ${key === 'star' ? 'btn-accent' : key === 'pro' ? 'btn-primary' : 'btn-secondary'}" style="width: 100%;">
                ${plan.price === 0 ? 'Empezar Gratis' : 'Seleccionar Plan'}
              </a>
            </div>
          `).join('')}
        </div>
      </section>

      <!-- Sección de Contacto y Bot de IA -->
      <section style="margin-top: 60px; padding: 40px 20px; background: var(--bg-primary); border-radius: var(--radius-lg); border: 1px solid var(--border-color); text-align: center;">
        <h2 style="font-size: 1.5rem; margin-bottom: 12px;" data-i18n="land_contact_title">Contacto Directo</h2>
        <p style="color: var(--text-secondary); font-size: 0.95rem; margin-bottom: 30px; max-width: 600px; margin-left: auto; margin-right: auto;" data-i18n="land_contact_subtitle">¿Tienes dudas adicionales o requieres una implementación personalizada?</p>
        
        <div style="display: flex; gap: 30px; justify-content: center; flex-wrap: wrap; margin-bottom: 40px;">
          <div style="display: flex; flex-direction: column; align-items: center; gap: 10px;">
            <div style="width: 50px; height: 50px; background: rgba(0, 123, 255, 0.1); color: var(--color-brand); border-radius: 50%; display: flex; align-items: center; justify-content: center;">
              <i data-lucide="mail"></i>
            </div>
            <span style="font-size: 0.8rem; color: var(--text-secondary);" data-i18n="land_contact_email_label">Correo Electrónico</span>
            <strong style="font-size: 1rem;">aiimplementaciones@gmail.com</strong>
          </div>
          
          <div style="display: flex; flex-direction: column; align-items: center; gap: 10px;">
            <div style="width: 50px; height: 50px; background: rgba(34, 197, 94, 0.1); color: var(--color-success); border-radius: 50%; display: flex; align-items: center; justify-content: center;">
              <i data-lucide="message-circle"></i>
            </div>
            <span style="font-size: 0.8rem; color: var(--text-secondary);" data-i18n="land_contact_phone_label">WhatsApp de Soporte</span>
            <strong style="font-size: 1rem;">+57 301 685 7098</strong>
          </div>
        </div>

        <div style="background: linear-gradient(135deg, rgba(0, 123, 255, 0.05), rgba(255, 165, 0, 0.05)); border: 1px dashed var(--color-brand); padding: 24px; border-radius: var(--radius-md); max-width: 700px; margin: 0 auto;">
          <h3 style="font-size: 1.1rem; color: var(--color-brand); margin-bottom: 12px; display: flex; align-items: center; justify-content: center; gap: 8px;">
            <i data-lucide="bot"></i> <span data-i18n="land_contact_bot_highlight">🚀 Soporte Inteligente 24/7</span>
          </h3>
          <p style="font-size: 0.9rem; color: var(--text-secondary); line-height: 1.6;" data-i18n="land_contact_bot_desc">Recuerda que nuestro bot de IA integrado puede responder a tus preguntas y resolver inquietudes de manera automática y precisa en tiempo real.</p>
        </div>
      </section>
    `;

    // Lógica del simulador interactivo de la Landing
    const demoStars = document.querySelectorAll('.demo-star');
    const demoResult = document.getElementById('landing-demo-result');

    demoStars.forEach(star => {
      star.addEventListener('click', () => {
        const rating = parseInt(star.getAttribute('data-index'));
        
        demoStars.forEach(s => {
          const idx = parseInt(s.getAttribute('data-index'));
          s.classList.toggle('filled', idx <= rating);
        });

        demoResult.style.display = 'block';
        if (rating === 5) {
          demoResult.innerHTML = `
            <div style="color:var(--color-success); font-weight:700; margin-bottom:6px;"><i data-lucide="check-circle" style="width:16px; height:16px; display:inline; vertical-align:middle; margin-right:4px;"></i> Redirección de 5 Estrellas</div>
            <p style="font-size:0.82rem; color:var(--text-secondary);">El sistema detecta una reseña excelente y le muestra un botón destacado para abrir tu perfil público de <strong>Google Maps</strong>. ¡Tu puntuación aumenta!</p>
            <button class="btn btn-accent" style="margin-top:10px; height:38px; font-size:0.8rem; pointer-events:none;">Abrir Google Maps</button>
          `;
        } else {
          demoResult.innerHTML = `
            <div style="color:var(--color-accent); font-weight:700; margin-bottom:6px;"><i data-lucide="alert-triangle" style="width:16px; height:16px; display:inline; vertical-align:middle; margin-right:4px;"></i> Intercepción de Crítica Privada</div>
            <p style="font-size:0.82rem; color:var(--text-secondary);">El sistema intercepta la molestia (1-4 estrellas) y despliega un formulario confidencial. Los datos se envían a tu panel interno de soporte de forma privada.</p>
            <input type="text" class="form-control" placeholder="¿Cómo podemos mejorar?" style="margin-top:8px; height:36px; font-size:0.8rem; text-align:center;" disabled>
          `;
        }
        lucide.createIcons();
      });
    });
  },

  // ==========================================================================
  // 🔐 CONTROL DE ACCESO Y AUTENTICACIÓN (Login / Registro)
  // ==========================================================================
  renderAuth(container, mode) {
    const isLogin = mode === 'login';

    container.innerHTML = `
      <div class="card auth-container">
        <h2 style="font-size: 1.3rem; margin-bottom: 20px; text-align:center;">
          🚀 <span data-i18n="${isLogin ? 'auth_title_login' : 'auth_title_register'}">Identificación</span>
        </h2>
        
        <form id="auth-form" style="display: flex; flex-direction: column; gap: 14px;">
          ${!isLogin ? `
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label" data-i18n="auth_label_business">Nombre de tu Comercio</label>
              <input type="text" class="form-control" id="auth-business" required placeholder="Mi Comercio S.A.">
            </div>
          ` : ''}
          
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label" data-i18n="auth_label_email">Correo Electrónico</label>
            <input type="email" class="form-control" id="auth-email" required placeholder="ejemplo@comercio.com" value="">
          </div>

          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label" data-i18n="auth_label_pass">Contraseña</label>
            <input type="password" class="form-control" id="auth-pass" required placeholder="••••••••" value="">
          </div>

          <button type="submit" class="btn btn-primary" style="margin-top:8px; height:46px;">
            <i data-lucide="${isLogin ? 'log-in' : 'user-plus'}"></i>
            <span data-i18n="${isLogin ? 'auth_btn_login' : 'auth_btn_register'}">Ingresar</span>
          </button>
        </form>

        <div style="text-align:center; margin-top:20px; font-size:0.85rem;">
          <a href="#${isLogin ? 'register' : 'login'}" style="color:var(--color-brand); text-decoration:none; font-weight:500;" data-i18n="${isLogin ? 'auth_switch_to_register' : 'auth_switch_to_login'}">
            Crear cuenta o ingresar
          </a>
        </div>
      </div>
    `;

    // Vincular envío del formulario de Auth
    document.getElementById('auth-form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (isLogin) {
        this.handleLoginSubmit();
      } else {
        this.handleRegisterSubmit();
      }
    });
  },

  async handleLoginSubmit() {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-pass').value;

    // 🚀 BYPASS SUPER ADMIN Y DESARROLLO
    if (email === 'admin@impulsa.com' && password === 'Estrella2026+') {
      this.addLog('SYSTEM', `Acceso Super Administrador concedido.`);
      
      // Intentar login REAL en Supabase
      if (supabaseClient) {
        this.addLog('SYSTEM', 'Admin Bypass: Autenticando en Supabase Auth...');
        await supabaseClient.auth.signInWithPassword({ email, password });
      }

      this.State.isSuperAdmin = true;
      this.State.currentUser = null; // No es un comercio específico
      Storage.setItem('impulsa_is_superadmin', 'true');
      Storage.setItem('impulsa_active_user', 'admin_bypass'); 
      
      // Sincronizar datos globales antes de redirigir
      if (supabaseClient) {
        await this.syncFromSupabase();
      }
      
      window.location.hash = '#admin';
      return;
    }

    if (email === 'mauro@prueba.com' && password === '16783399') {
      const devUserId = '36d917a3-f764-4afe-8c87-e1db8f0f1731';
      const devLocId = '00000000-0000-0000-0000-000000000002';
      
      this.addLog('SYSTEM', `Acceso bypass para desarrollo: ${email}`);
      this.State.currentUser = {
        id: devUserId,
        businessName: 'Prueba Mauro',
        fullName: 'Mauro Sanchez',
        email: email,
        whatsapp: '573000000000',
        address: 'Calle Falsa 123',
        plan: 'pro',
        logo: '🚀',
        accentColor: '#6366f1',
        title: 'Opiniones de Prueba Mauro'
      };
      this.State.isSuperAdmin = false;
      Storage.setItem('impulsa_active_user', devUserId);
      Storage.setItem('impulsa_is_superadmin', 'false');
      
      // Simular sincronización básica con UUIDs válidos (Datos reales vendrán de syncFromSupabase)
      this.State.locations = [];
      this.State.leads = [];
      
      await this.syncFromSupabase();
      window.location.hash = '#dashboard';
      return;
    }

    if (supabaseClient) {
      this.addLog('SYSTEM', `Intentando iniciar sesión en Supabase para: ${email}`);
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
      
      if (error) {
        alert(error.message);
        this.addLog('SYSTEM', `Fallo de autenticación: ${error.message}`);
        return;
      }

      this.addLog('SYSTEM', `Autenticación exitosa en Supabase.`);
      await this.syncFromSupabase();
      window.location.hash = '#dashboard';
    } else {
      const user = this.State.users.find(u => u.email === email && u.password === password);

      if (user) {
        this.State.currentUser = user;
        this.State.isSuperAdmin = false;
        Storage.setItem('impulsa_active_user', user.id);
        Storage.setItem('impulsa_is_superadmin', 'false');

        this.addLog('SYSTEM', `Sesión iniciada exitosamente por comercio (Local): "${user.businessName}"`);
        window.location.hash = '#dashboard';
      } else {
        alert(this.t('auth_error'));
      }
    }
  },

  async handleRegisterSubmit() {
    const businessName = document.getElementById('auth-business').value;
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-pass').value;

    if (supabaseClient) {
      this.addLog('SYSTEM', `Registrando comercio en Supabase: "${businessName}" (${email})`);
      const { data, error } = await supabaseClient.auth.signUp({ 
        email, 
        password,
        options: {
          data: {
            business_name: businessName,
            full_name: '' // Se completará después
          }
        }
      });

      if (error) {
        alert(error.message);
        return;
      }

      if (data.user) {
        const userId = data.user.id;
        
        // Esperamos un momento a que el trigger actúe (opcional pero recomendado en client-side si se va a usar el perfil de inmediato)
        // Aunque Supabase es rápido, a veces la consistencia eventual puede tardar milisegundos.

        // 2. Crear local inicial Starter de cortesía en la tabla locations (tenant_id es la FK a profiles.id)
        const { data: newLoc, error: locError } = await supabaseClient.from('locations').insert([{
          tenant_id: userId,
          name: `Sede Principal ${businessName}`,
          address: 'Dirección Comercial Principal',
          maps_url: 'https://maps.google.com',
          status: 'active'
        }]).select().single();

        if (locError) {
          this.addLog('SYSTEM', `Error al crear local inicial: ${locError.message}`);
        }

        this.addLog('SYSTEM', `Nuevo comercio registrado exitosamente en Supabase.`);
        alert(this.t('auth_success_register'));
        await this.syncFromSupabase();
        window.location.hash = '#dashboard';
      }
    } else {
      // Crear nuevo Tenant Local
      const newUser = {
        id: `user_${Date.now()}`,
        businessName,
        email,
        password,
        plan: 'free',
        logo: '🏪',
        accentColor: '#4F46E5',
        title: `Opiniones de ${businessName}`
      };

      this.State.users.push(newUser);
      this.saveUsers();

      // Crear 1 sucursal inicial Starter de cortesía local
      const firstLoc = {
        id: `loc_${Date.now()}`,
        userId: newUser.id,
        name: `Sede Principal ${businessName}`,
        address: 'Dirección Comercial Principal',
        mapsUrl: 'https://maps.google.com',
        status: 'active'
      };
      this.State.locations.push(firstLoc);
      this.saveLocations();

      this.addLog('SYSTEM', `Nuevo comercio registrado localmente: "${businessName}"`);

      // Loguear inmediatamente
      this.State.currentUser = newUser;
      this.State.isSuperAdmin = false;
      Storage.setItem('impulsa_active_user', newUser.id);
      Storage.setItem('impulsa_is_superadmin', 'false');

      alert(this.t('auth_success_register'));
      window.location.hash = '#dashboard';
    }
  },

  async handleLogout() {
    if (supabaseClient) {
      await supabaseClient.auth.signOut();
    }
    this.State.currentUser = null;
    this.State.isSuperAdmin = false;
    Storage.setItem('impulsa_active_user', '');
    Storage.setItem('impulsa_is_superadmin', 'false');
    
    this.addLog('SYSTEM', 'Sesión cerrada. Redirigiendo a página de ventas principal.');
    window.location.hash = '#home';
  },

  // ==========================================================================
  // 💼 VISTA: MI PANEL COMERCIAL (Client Dashboard)
  // ==========================================================================
  renderDashboard(container) {
    const user = this.State.currentUser;
    
    // Filtrar recursos que pertenecen EXCLUSIVAMENTE a este Tenant comercial
    const userLocations = this.State.locations.filter(l => l.userId === user.id);
    const userLocIds = userLocations.map(l => l.id);
    const userLeads = this.State.leads.filter(lead => userLocIds.includes(lead.locationId));

    // Métricas reales
    const totalLeads = userLeads.length;
    // Las visitas son 0 a menos que haya leads (mínimo real detectable)
    const userVisits = Math.max(this.State.visits, totalLeads); 
    const conversionRate = userVisits > 0 ? Math.round(((userVisits - totalLeads) / userVisits) * 100) : 100;
    const avgRating = totalLeads > 0 
      ? (userLeads.reduce((acc, curr) => acc + curr.rating, 0) / totalLeads).toFixed(1)
      : '5.0';

    // Cálculo de Plan y Sucursales (NUEVO)
    const planKey = user.plan || 'free';
    const planInfo = this.plansConfig[planKey] || { name: 'Plan Starter', limit: 1 };
    const planLimit = planInfo.limit === Infinity ? null : planInfo.limit;
    const usedBranches = userLocations.length;
    const remainingBranches = planLimit === null ? 'Ilimitado' : Math.max(0, planLimit - usedBranches);
    
    const startDate = user.subscriptionDate ? new Date(user.subscriptionDate).toLocaleDateString() : 'N/A';
    const expiryDate = user.subscriptionExpiry ? new Date(user.subscriptionExpiry).toLocaleDateString() : 'N/A';

    container.innerHTML = `
      ${(!user.city || !user.fullName) ? `
        <div class="card" style="border-left: 6px solid var(--color-warning); background-color: rgba(245, 158, 11, 0.05); margin-bottom: 20px;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <i data-lucide="alert-circle" style="color: var(--color-warning);"></i>
            <div>
              <h4 style="margin: 0; font-size: 0.95rem;">Perfil Incompleto</h4>
              <p style="margin: 4px 0 0 0; font-size: 0.82rem; color: var(--text-secondary);">Completa tu información (Ciudad y Nombre Completo) para una mejor experiencia y soporte.</p>
            </div>
          </div>
        </div>
      ` : ''}

      <!-- Notificaciones del Administrador (NUEVO) -->
      ${this.State.messages.length > 0 ? `
        <div class="card" style="border-left: 6px solid var(--color-brand); margin-bottom: 24px; background: rgba(0, 123, 255, 0.02);">
          <h3 class="card-title"><i data-lucide="bell"></i> Mensajes de la Plataforma</h3>
          <div style="margin-top: 12px; display: flex; flex-direction: column; gap: 10px;">
            ${this.State.messages.map(m => `
              <div style="padding: 12px; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 8px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                  <strong style="font-size: 0.85rem; color: var(--color-brand);">${m.sender}</strong>
                  <span style="font-size: 0.7rem; color: var(--text-secondary);">${new Date(m.date).toLocaleString()}</span>
                </div>
                <p style="font-size: 0.88rem; margin: 0; line-height: 1.5;">${m.content}</p>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <div class="card" style="background: linear-gradient(135deg, rgba(0, 123, 255, 0.1), rgba(255, 165, 0, 0.05)); border-color: rgba(0, 123, 255, 0.25);">
        <h2 style="font-size: 1.5rem; margin-bottom: 8px;">
          🚀 <span data-i18n="dash_welcome">¡Hola de nuevo!</span>, ${user.businessName}
        </h2>
        <p style="color: var(--text-secondary); font-size: 0.9rem;">
          <span data-i18n="dash_overview">Resumen de Reputación de</span> <strong>${user.businessName}</strong>.
        </p>
      </div>

      <!-- Métricas del Negocio -->
      <div class="metrics-row">
        <div class="metric-card">
          <span class="metric-label" data-i18n="dash_total_reviews">Visitas Detectadas</span>
          <div class="metric-value">${userVisits}</div>
        </div>
        <div class="metric-card">
          <span class="metric-label" data-i18n="dash_conversion">Conversión</span>
          <div class="metric-value">${conversionRate}%</div>
        </div>
        <div class="metric-card">
          <span class="metric-label" data-i18n="dash_avg_stars">Calificación Promedio</span>
          <div class="metric-value" style="display: flex; align-items: center; gap: 4px;">
            ${avgRating} <i data-lucide="star" style="fill: #FFD700; stroke: #FFD700; width: 20px; height: 20px;"></i>
          </div>
        </div>
        <div class="metric-card">
          <span class="metric-label" data-i18n="dash_saved_reputation">Crisis Mitigadas</span>
          <div class="metric-value" style="color: var(--color-success);">${totalLeads}</div>
        </div>
      </div>

      <!-- Resumen del Plan (NUEVO) -->
      <div class="card" style="margin-bottom: 24px; border-top: 4px solid var(--color-accent);">
        <h3 class="card-title"><i data-lucide="credit-card"></i> Estado de mi Suscripción</h3>
        <div class="responsive-grid" style="margin-top: 16px;">
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <span style="font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase;" data-i18n="dash_plan_current">Plan Actual</span>
            <strong style="font-size: 1.1rem; color: var(--color-accent);">${planInfo.name}</strong>
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <span style="font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase;" data-i18n="dash_plan_locations">Sucursales</span>
            <strong style="font-size: 1.1rem;">${usedBranches} de ${planLimit || '∞'} usadas</strong>
            <span style="font-size: 0.7rem; color: var(--text-secondary);">${remainingBranches} <span data-i18n="dash_plan_remaining">pendientes</span></span>
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <span style="font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase;" data-i18n="dash_plan_validity">Vigencia</span>
            <div style="display: flex; gap: 12px; align-items: center;">
              <div>
                <span style="display: block; font-size: 0.7rem; color: var(--text-secondary);" data-i18n="dash_plan_start">Inicio</span>
                <strong style="font-size: 0.9rem;">${startDate}</strong>
              </div>
              <div style="width: 1px; height: 20px; background: var(--border-color);"></div>
              <div>
                <span style="display: block; font-size: 0.7rem; color: var(--text-secondary);" data-i18n="dash_plan_expiry">Vencimiento</span>
                <strong style="font-size: 0.9rem; color: var(--color-danger);">${expiryDate}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="responsive-grid">
        <!-- Datos del Perfil -->
        <div class="card">
          <h3 class="card-title"><i data-lucide="user"></i> Datos del Perfil y Contacto</h3>
          <form id="contact-data-form" style="margin-top:16px; display:flex; flex-direction:column; gap:12px;">
            <div class="form-group">
              <label class="form-label">Nombre del Negocio / Marca</label>
              <input type="text" class="form-control" id="contact-business" value="${user.businessName || ''}" required>
            </div>
            <div class="form-group">
              <label class="form-label">Nombre Completo del Responsable</label>
              <input type="text" class="form-control" id="contact-fullname" value="${user.fullName || ''}" required placeholder="Ej: Juan Pérez">
            </div>
            <div class="form-group">
              <label class="form-label">WhatsApp Corporativo (Reportes)</label>
              <input type="tel" class="form-control" id="contact-whatsapp" value="${user.whatsapp || ''}" required>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Ciudad</label>
                <input type="text" class="form-control" id="contact-city" value="${user.city || ''}" required placeholder="Medellín">
              </div>
              <div class="form-group">
                <label class="form-label">Dirección Principal</label>
                <input type="text" class="form-control" id="contact-address" value="${user.address || ''}" required>
              </div>
            </div>
            <button type="submit" class="btn btn-secondary">
              <i data-lucide="save"></i> Actualizar Perfil Completo
            </button>
          </form>
        </div>

        <!-- Enlaces Rápidos y QR -->
        <div class="card">
          <h3 class="card-title"><i data-lucide="qr-code"></i> Mi Enlace de Calificación</h3>
          <div style="margin-top: 16px; text-align: center; display: flex; flex-direction: column; align-items: center;">
            <div style="width: 60px; height: 60px; border-radius: 50%; border: 2px solid ${user.accentColor || 'var(--border-color)'}; margin-bottom: 10px; display: flex; align-items: center; justify-content: center; overflow: hidden; background: white;">
                ${user.logo && user.logo.startsWith('http') ? `<img src="${user.logo}" style="width:100%; height:100%; object-fit:cover;">` : user.logo || '🏪'}
            </div>
            <strong style="font-size: 1rem; color: var(--text-primary); margin-bottom: 4px;">${user.businessName}</strong>
            <p style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 12px;">Usa este enlace en tus redes sociales.</p>
            <div style="background: var(--bg-primary); padding: 12px; border-radius: 8px; border: 1px dashed var(--border-color); font-family: monospace; font-size: 0.8rem; margin-bottom: 16px; word-break: break-all; width: 100%;">
              ${window.location.origin}/#portal?id=${userLocations[0]?.id || 'demo'}
            </div>
            <div style="display: flex; gap: 8px; justify-content: center;">
              <button class="btn btn-primary" onclick="navigator.clipboard.writeText('${window.location.origin}/#portal?id=${userLocations[0]?.id || 'demo'}'); alert('Enlace copiado');">
                <i data-lucide="copy"></i> Copiar
              </button>
              <a href="#locations" class="btn btn-secondary">
                <i data-lucide="map-pin"></i> Ver Sedes
              </a>
            </div>
          </div>
        </div>
      </div>

      <!-- Personalización con Simulador en Vivo -->
      <div class="customization-grid">
        <div class="card">
          <h3 class="card-title"><i data-lucide="palette"></i> Personalizar mi Portal</h3>
          <form id="portal-config-form" style="margin-top:16px; display:flex; flex-direction:column; gap:12px;">
            <div class="form-group">
              <label class="form-label">Logotipo del Portal</label>
              <div style="display: flex; gap: 10px; align-items: center;">
                <div id="logo-preview-box" style="width: 50px; height: 50px; border: 1px solid var(--border-color); border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; background: white; overflow: hidden;">
                  ${user.logo && user.logo.startsWith('http') ? `<img src="${user.logo}" style="width:100%; height:100%; object-fit:cover;">` : user.logo || '🏪'}
                </div>
                <input type="file" id="logo-upload" accept="image/*" style="display:none;">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('logo-upload').click()">
                  <i data-lucide="upload"></i> Subir Logo
                </button>
                <input type="text" id="portal-logo-val" value="${user.logo || '🏪'}" style="display:none;">
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Color de Marca (Botones/Bordes)</label>
              <input type="color" class="form-control" id="portal-color" value="${user.accentColor || '#6366f1'}" style="height: 40px; padding: 2px;">
            </div>
            <div class="form-group">
              <label class="form-label">Color de Fondo del Portal</label>
              <input type="color" class="form-control" id="portal-bg-color" value="${user.bgColor || '#ffffff'}" style="height: 40px; padding: 2px;">
            </div>
            <div class="form-group">
              <label class="form-label">Título del Portal</label>
              <input type="text" class="form-control" id="portal-title" required value="${user.title || ''}" placeholder="Ej. Opiniones Burger Master">
            </div>
            <button type="submit" class="btn btn-accent" style="margin-top:6px;">
              <i data-lucide="save"></i> Guardar Cambios de Diseño
            </button>
            </form>
            </div>

            <!-- NUEVO: PERSONALIZACIÓN DE HABLADOR IMPRIMIBLE -->
            <div class="card">
            <h3 class="card-title"><i data-lucide="printer"></i> Hablador Imprimible (QR)</h3>
            <p style="font-size: 0.82rem; color: var(--text-secondary); margin-bottom: 12px; margin-top: 8px;">
            Personaliza el diseño físico de tus mesas.
            </p>

            <form id="qr-config-form" style="display: flex; flex-direction: column; gap: 12px;">
            <div class="form-group">
              <label class="form-label">Color de Cabecera (QR)</label>
              <input type="color" class="form-control" id="qr-accent-color" value="${user.qrAccentColor || '#6366f1'}" style="height: 38px; padding: 2px;">
            </div>
            <div class="form-group">
              <label class="form-label">Texto del Pie de Página</label>
              <input type="text" class="form-control" id="qr-footer-text" value="${user.qrFooterText || '¡Tu opinión nos ayuda a crecer!'}" placeholder="Ej. ¡Gracias por elegirnos!">
            </div>
            <div class="form-group">
              <label class="form-label">Imagen de Marca (Opcional)</label>
              <div style="display: flex; gap: 8px; align-items: center;">
                <div id="qr-img-preview" style="width: 45px; height: 45px; border: 1px solid var(--border-color); border-radius: 6px; display: flex; align-items: center; justify-content: center; background: white; overflow: hidden;">
                  ${user.qrCustomImage ? `<img src="${user.qrCustomImage}" style="width:100%; height:100%; object-fit:cover;">` : '<i data-lucide="image" style="width:16px; opacity:0.3;"></i>'}
                </div>
                <input type="file" id="qr-img-upload" accept="image/*" style="display:none;">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('qr-img-upload').click()" style="font-size: 0.75rem; padding: 6px 10px;">
                  <i data-lucide="upload"></i> Cambiar
                </button>
                <input type="hidden" id="qr-img-val" value="${user.qrCustomImage || ''}">
              </div>
            </div>
            <button type="submit" class="btn btn-primary" style="margin-top:4px;">
              <i data-lucide="save"></i> Guardar Diseño QR
            </button>
            </form>
            </div>

            <!-- Simulador de Celular en Tiempo Real -->
        <div class="card" style="padding: 20px; display: flex; flex-direction: column; align-items: center; overflow: hidden;">
          <h4 style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 12px; text-transform: uppercase;">Vista Previa</h4>
          <div class="phone-simulator-dashboard" style="width: 100%; max-width: 200px; height: 400px; background: #1a1a1a; border-radius: 30px; border: 6px solid #333; position: relative; overflow: hidden; box-shadow: var(--shadow-lg);">
            <div style="width: 60px; height: 12px; background: #333; position: absolute; top: 0; left: 50%; transform: translateX(-50%); border-bottom-left-radius: 8px; border-bottom-right-radius: 8px; z-index: 2;"></div>
            <div id="sim-screen" style="width: 100%; height: 100%; background: ${user.bgColor || 'white'}; display: flex; flex-direction: column; align-items: center; padding: 30px 10px; text-align: center; gap: 10px;">
              <div id="sim-logo" style="width: 50px; height: 50px; border-radius: 50%; border: 2px solid ${user.accentColor || '#6366f1'}; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; overflow:hidden; background: white;">
                ${user.logo && user.logo.startsWith('http') ? `<img src="${user.logo}" style="width:100%; height:100%; object-fit:cover;">` : user.logo || '🏪'}
              </div>
              <h5 id="sim-title" style="font-size: 0.8rem; margin: 0; color: #333;">${user.title || 'Mi Negocio'}</h5>
              <p style="font-size: 0.5rem; color: #666;">¿Cómo fue tu experiencia hoy?</p>
              <div style="display: flex; gap: 2px;">
                ${Array.from({ length: 5 }).map(() => `<i data-lucide="star" style="width: 12px; height: 12px; color: #FFD700; fill: #FFD700;"></i>`).join('')}
              </div>
              <div id="sim-button" style="margin-top: auto; width: 100%; background: ${user.accentColor || '#6366f1'}; color: white; padding: 8px; border-radius: 6px; font-size: 0.6rem; font-weight: 700;">
                ENVIAR OPINIÓN
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Últimos Casos -->
      <div class="card">
        <h3 class="card-title"><i data-lucide="alert-triangle" style="color: var(--color-accent)"></i> Casos Recientes (Reales)</h3>
        <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 16px;">
          ${userLeads.length === 0 ? `
            <p style="text-align:center; font-size:0.88rem; color:var(--text-secondary);">No se han detectado críticas negativas aún. ¡Buen trabajo!</p>
          ` : userLeads.slice(-3).reverse().map(lead => `
            <div style="padding: 14px; border-radius: var(--radius-md); background-color: var(--bg-primary); border: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;">
              <div>
                <strong style="font-size: 0.9rem;">${lead.clientName}</strong>
                <div style="font-size: 0.7rem; color: var(--text-secondary);">${new Date(lead.date).toLocaleDateString()} - ${lead.locationName}</div>
                <p style="font-size: 0.8rem; margin-top: 4px;">"${lead.comment}"</p>
              </div>
              <div style="text-align: right;">
                <div style="margin-bottom: 8px;">${'★'.repeat(lead.rating)}${'☆'.repeat(5 - lead.rating)}</div>
                <div style="display: flex; gap: 4px; justify-content: flex-end;">
                  <a href="https://wa.me/${lead.clientPhone}" target="_blank" class="btn btn-primary" style="padding: 5px 8px; font-size: 0.7rem; width: auto; height: 32px;">
                    <i data-lucide="phone" style="width: 14px; height: 14px;"></i> <span data-i18n="admin_table_action">Contactar</span>
                  </a>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    // Lógica del simulador en vivo
    const titleInput = document.getElementById('portal-title');
    const colorInput = document.getElementById('portal-color');
    const bgInput = document.getElementById('portal-bg-color');
    const simTitle = document.getElementById('sim-title');
    const simButton = document.getElementById('sim-button');
    const simLogoBox = document.getElementById('sim-logo');
    const simScreen = document.getElementById('sim-screen');

    titleInput.addEventListener('input', (e) => simTitle.textContent = e.target.value || 'Mi Negocio');
    colorInput.addEventListener('input', (e) => {
      simButton.style.backgroundColor = e.target.value;
      simLogoBox.style.borderColor = e.target.value;
    });
    bgInput.addEventListener('input', (e) => {
      simScreen.style.backgroundColor = e.target.value;
    });

    // Lógica de carga de logo
    const logoUpload = document.getElementById('logo-upload');
    const logoPreview = document.getElementById('logo-preview-box');
    const logoVal = document.getElementById('portal-logo-val');

    logoUpload.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const base64 = event.target.result;
          logoPreview.innerHTML = `<img src="${base64}" style="width:100%; height:100%; object-fit:cover;">`;
          simLogoBox.innerHTML = `<img src="${base64}" style="width:100%; height:100%; object-fit:cover;">`;
          logoVal.value = base64; // Guardamos el base64 temporalmente
        };
        reader.readAsDataURL(file);
      }
    });

    // Vincular envío de configuraciones
    document.getElementById('portal-config-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleSavePortalConfig();
    });

    // NUEVO: Vincular envío de configuración QR
    const qrConfigForm = document.getElementById('qr-config-form');
    if (qrConfigForm) {
      qrConfigForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleSaveQRConfig();
      });
    }

    // NUEVO: Lógica de carga de imagen para QR
    const qrImgUpload = document.getElementById('qr-img-upload');
    const qrImgPreview = document.getElementById('qr-img-preview');
    const qrImgVal = document.getElementById('qr-img-val');

    if (qrImgUpload) {
      qrImgUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (event) => {
            const base64 = event.target.result;
            qrImgPreview.innerHTML = `<img src="${base64}" style="width:100%; height:100%; object-fit:cover;">`;
            qrImgVal.value = base64;
          };
          reader.readAsDataURL(file);
        }
      });
    }

    const contactForm = document.getElementById('contact-data-form');
    if (contactForm) {
      contactForm.addEventListener('submit', (e) => {
        e.preventDefault();
        App.handleSaveContactData();
      });
    }

    lucide.createIcons();
    // Aplicar color inicial al simulador
    simButton.style.backgroundColor = colorInput.value;
    simLogoBox.style.borderColor = colorInput.value;
    simScreen.style.backgroundColor = bgInput.value;
  },

  async handleSavePortalConfig() {
    const logoBase64 = document.getElementById('portal-logo-val').value;
    const title = document.getElementById('portal-title').value;
    const accentColor = document.getElementById('portal-color').value;
    const bgColor = document.getElementById('portal-bg-color').value;

    const user = this.State.currentUser;
    let finalLogoUrl = logoBase64;

    if (supabaseClient) {
      this.addLog('POST', `Guardando diseño del portal en Supabase para: ${user.businessName}`);

      // 1. Si el logo es una imagen nueva (base64), subirla a Supabase Storage
      if (logoBase64.startsWith('data:image')) {
        try {
          // --- NUEVA LÓGICA: Borrar logo anterior si existe ---
          if (user.logo && user.logo.includes('/storage/v1/object/')) {
            try {
              // Extraer el path del archivo de la URL firmada o pública
              // Las URLs de Supabase suelen tener el formato: .../logos/public/ID_USER/file.ext o con tokens
              // Intentamos extraer la parte relativa al bucket
              const urlParts = user.logo.split('/logos/');
              if (urlParts.length > 1) {
                let filePath = urlParts[1].split('?')[0]; // Quitar parámetros de firma
                // Limpiar posibles prefijos como 'public/' o 'sign/' si existen en la URL
                filePath = filePath.replace(/^(public\/|sign\/)/, '');
                
                await supabaseClient.storage.from('logos').remove([filePath]);
                this.addLog('SYSTEM', `Logo anterior eliminado para limpieza: ${filePath}`);
              }
            } catch (err) {
              console.warn("No se pudo borrar el logo anterior, procediendo con la subida:", err);
            }
          }
          // ---------------------------------------------------

          const fileExt = logoBase64.split(';')[0].split('/')[1];
          const fileName = `${user.id}/logo_${Date.now()}.${fileExt}`;
          
          // Convertir base64 a Blob para subir
          const base64Data = logoBase64.split(',')[1];
          const blob = await (await fetch(logoBase64)).blob();

          const { data: uploadData, error: uploadError } = await supabaseClient
            .storage
            .from('logos')
            .upload(fileName, blob, {
              contentType: `image/${fileExt}`,
              upsert: true
            });

          if (uploadError) throw uploadError;

          // Obtener URL firmada de larga duración (10 años)
          const { data: signedData, error: signedError } = await supabaseClient
            .storage
            .from('logos')
            .createSignedUrl(fileName, 315360000); 
          
          if (signedError) throw signedError;
          finalLogoUrl = signedData.signedUrl;
        } catch (err) {
          console.error("Error gestionando logo:", err);
          alert("Error al gestionar el logo en el servidor: " + err.message);
          return;
        }
      }

      const { error } = await supabaseClient
        .from('profiles')
        .update({
          logo: finalLogoUrl,
          accent_color: accentColor,
          bg_color: bgColor,
          portal_title: title
        })
        .eq('id', user.id);

      if (error) {
        alert("Error al guardar en Supabase: " + error.message);
        return;
      }
      await this.syncFromSupabase();
    }
    
    alert("Diseño del portal actualizado correctamente.");
    this.renderPageContent('dashboard');
  },

  async handleSaveContactData() {
    const businessName = document.getElementById('contact-business').value;
    const fullName = document.getElementById('contact-fullname').value;
    const whatsapp = document.getElementById('contact-whatsapp').value;
    const city = document.getElementById('contact-city').value;
    const address = document.getElementById('contact-address').value;

    const user = this.State.currentUser;

    if (supabaseClient) {
      this.addLog('POST', `Actualizando datos de contacto en Supabase para: ${user.businessName}`);

      const { error } = await supabaseClient
        .from('profiles')
        .update({
          business_name: businessName,
          full_name: fullName,
          whatsapp: whatsapp,
          city: city,
          address: address
        })
        .eq('id', user.id);

      if (error) {
        alert("Error al guardar datos de contacto: " + error.message);
        return;
      }
      await this.syncFromSupabase();
    }
    
    alert("Datos de contacto actualizados correctamente.");
    this.renderPageContent('dashboard');
  },

  async handleSaveQRConfig() {
    const qrImgBase64 = document.getElementById('qr-img-val').value;
    const accentColor = document.getElementById('qr-accent-color').value;
    const footerText = document.getElementById('qr-footer-text').value;

    const user = this.State.currentUser;
    let finalImgUrl = qrImgBase64;

    if (supabaseClient) {
      this.addLog('POST', `Guardando diseño de hablador QR en Supabase para: ${user.businessName}`);

      if (qrImgBase64.startsWith('data:image')) {
        try {
          const fileExt = qrImgBase64.split(';')[0].split('/')[1];
          const fileName = `${user.id}/qr_custom_${Date.now()}.${fileExt}`;
          const blob = await (await fetch(qrImgBase64)).blob();

          const { data: uploadData, error: uploadError } = await supabaseClient
            .storage
            .from('logos')
            .upload(fileName, blob, { contentType: `image/${fileExt}`, upsert: true });

          if (uploadError) throw uploadError;

          const { data: signedData, error: signedError } = await supabaseClient
            .storage
            .from('logos')
            .createSignedUrl(fileName, 315360000); 
          
          if (signedError) throw signedError;
          finalImgUrl = signedData.signedUrl;
        } catch (err) {
          console.error("Error gestionando imagen QR:", err);
          alert("Error al gestionar la imagen: " + err.message);
          return;
        }
      }

      const { error } = await supabaseClient
        .from('profiles')
        .update({
          qr_accent_color: accentColor,
          qr_custom_image: finalImgUrl,
          qr_footer_text: footerText
        })
        .eq('id', user.id);

      if (error) {
        alert("Error al guardar en Supabase: " + error.message);
        return;
      }
      await this.syncFromSupabase();
    }
    
    alert("Diseño de hablador QR actualizado correctamente.");
    this.renderPageContent('dashboard');
  },

  // ==========================================================================
  // 📍 VISTA: MIS SUCURSALES COMERCIALES (LocationsPage)
  // ==========================================================================
  renderLocations(container) {
    const user = this.State.currentUser;
    const userLocations = this.State.locations.filter(l => l.userId === user.id);
    const activeLocationsCount = userLocations.filter(l => l.status === 'active').length;
    const limit = this.PlanLimits[user.plan];

    container.innerHTML = `
      <div style="margin-bottom: 24px;">
        <h2 style="font-size: 1.4rem;" data-i18n="loc_title">🚀 Gestión Inteligente de Sucursales</h2>
        <p style="color: var(--text-secondary); font-size: 0.88rem;" data-i18n="loc_subtitle">Registra y monitoriza los puntos físicos de tu negocio.</p>
      </div>

      <!-- Tarjeta del Formulario de Creación -->
      <div class="responsive-grid">
        <div class="card">
          <h3 class="card-title"><i data-lucide="plus-circle"></i> <span data-i18n="loc_add_btn">Agregar Nueva Sucursal</span></h3>
          <form id="add-location-form" style="margin-top: 16px; display: flex; flex-direction: column; gap: 12px;">
            <div class="form-group" style="margin-bottom: 0;">
              <label class="form-label" data-i18n="loc_name_placeholder">Nombre de la sucursal</label>
              <input type="text" class="form-control" id="new-loc-name" required placeholder="Mi Sede Laureles">
            </div>
            <div class="form-group" style="margin-bottom: 0;">
              <label class="form-label" data-i18n="loc_address_placeholder">Dirección física</label>
              <input type="text" class="form-control" id="new-loc-address" required placeholder="Av. Nutibara #38-12">
            </div>
            <div class="form-group" style="margin-bottom: 0;">
              <label class="form-label" data-i18n="loc_maps_placeholder">Enlace de Google Maps</label>
              <input type="url" class="form-control" id="new-loc-maps" required placeholder="https://maps.google.com/...">
            </div>
            <button type="submit" class="btn btn-primary" style="margin-top: 8px;">
              <i data-lucide="plus"></i> <span data-i18n="loc_add_btn">Agregar Sucursal</span>
            </button>
          </form>
        </div>

        <div class="card" style="border: 1px dashed var(--color-brand); background-color: rgba(79, 70, 229, 0.02);">
          <h3 class="card-title" style="color: var(--color-brand);"><i data-lucide="sparkles"></i> ¿Lo hacemos por ti?</h3>
          <p style="font-size: 0.82rem; color: var(--text-secondary); margin-bottom: 12px;">Si prefieres que nosotros configuremos tu sucursal con el mejor diseño, solicita una creación profesional.</p>
          <button id="open-req-modal" class="btn btn-secondary" style="border-color: var(--color-brand); color: var(--color-brand); height: 44px;">
            <i data-lucide="clipboard-list"></i> Llenar Cuestionario de Solicitud
          </button>
          <div style="margin-top: 12px; font-size: 0.75rem; color: var(--color-brand); font-weight: 500; display: flex; align-items: center; gap: 4px;">
            <i data-lucide="check-circle" style="width: 14px; height: 14px;"></i> Nuestro equipo la creará en menos de 24h.
          </div>
        </div>
      </div>

      <!-- Alerta de Límites de Plan -->
      <div style="padding: 10px 16px; border-radius: var(--radius-md); background-color: rgba(0, 123, 255, 0.08); border: 1px solid rgba(0, 123, 255, 0.15); margin-bottom: 20px; font-size: 0.82rem; display: flex; justify-content: space-between; align-items: center;">
        <span style="display: flex; align-items: center; gap: 6px;">
          <i data-lucide="info" style="color: var(--color-brand); width: 16px; height: 16px;"></i>
          <span>Activos: <strong>${activeLocationsCount} / ${limit === Infinity ? 'Ilimitado' : limit}</strong></span>
        </span>
        <a href="#billing" class="btn btn-secondary" style="width: auto; padding: 4px 10px; font-size: 0.75rem; border-radius: 6px;" data-i18n="bill_upgrade_btn">Actualizar Plan</a>
      </div>

      <!-- Listado de Sucursales -->
      <div class="locations-grid" id="locations-list">
        ${userLocations.map(loc => {
          const isActive = loc.status === 'active';
          return `
            <div class="card location-card" id="card-${loc.id}">
              <div class="location-header">
                <div class="location-info">
                  <h3>${loc.name}</h3>
                  <p><i data-lucide="map-pin"></i> ${loc.address}</p>
                </div>
                <!-- Badge interactivo de LED -->
                <span class="status-badge ${isActive ? 'active' : 'inactive'}" id="badge-${loc.id}">
                  <span class="led-dot"></span>
                  <span id="badge-text-${loc.id}">${this.t(isActive ? 'active' : 'inactive')}</span>
                </span>
              </div>
              
              <div style="display: flex; align-items: center; justify-content: space-between; padding-top: 12px; border-top: 1px solid var(--border-color); margin-top: 4px;">
                <span style="font-size: 0.85rem; color: var(--text-secondary);" data-i18n="loc_status_badge">Estado</span>
                <!-- Switch de Cambio de Estado al Instante -->
                <label class="switch-control">
                  <input type="checkbox" class="loc-toggle" data-id="${loc.id}" ${isActive ? 'checked' : ''}>
                  <span class="switch-slider"></span>
                </label>
              </div>

              <!-- Acciones de QR e Impresión -->
              <div class="location-actions">
                <button class="btn btn-secondary download-qr-btn" data-id="${loc.id}" data-name="${loc.name}" style="padding: 8px 12px; font-size: 0.8rem; border-radius: var(--radius-sm);">
                  <i data-lucide="download"></i> <span data-i18n="loc_download_qr">Hablador</span>
                </button>
                <button class="btn btn-secondary print-qr-btn" data-id="${loc.id}" data-name="${loc.name}" style="padding: 8px 12px; font-size: 0.8rem; border-radius: var(--radius-sm);">
                  <i data-lucide="printer"></i> Imprimir
                </button>
              </div>

              <!-- Acciones de Gestión (Editar/Borrar) -->
              <div class="location-actions">
                <button class="btn btn-secondary edit-loc-btn" data-id="${loc.id}" style="padding: 8px 12px; font-size: 0.8rem; border-radius: var(--radius-sm);">
                  <i data-lucide="edit"></i> Editar
                </button>
                <button class="btn btn-danger delete-loc-btn" data-id="${loc.id}" style="padding: 8px 12px; font-size: 0.8rem; border-radius: var(--radius-sm);">
                  <i data-lucide="trash-2"></i> Borrar
                </button>
              </div>

              <div style="margin-top: 8px; display: flex; flex-direction: column; gap: 8px;">
                <div style="display: flex; gap: 8px; width: 100%;">
                  <button class="btn btn-secondary" onclick="navigator.clipboard.writeText('${window.location.origin}/#portal?id=${loc.id}'); alert('Enlace de sucursal copiado');" style="flex: 1; padding: 8px 12px; font-size: 0.8rem; border-radius: var(--radius-sm);">
                    <i data-lucide="copy"></i> Copiar Enlace
                  </button>
                  <button class="btn btn-secondary share-loc-btn" data-id="${loc.id}" data-name="${loc.name}" style="flex: 1; padding: 8px 12px; font-size: 0.8rem; border-radius: var(--radius-sm);">
                    <i data-lucide="share-2"></i> Compartir
                  </button>
                </div>
                <a href="#portal?id=${loc.id}" target="_blank" class="btn btn-primary" style="padding: 8px 12px; font-size: 0.8rem; border-radius: var(--radius-sm); background: linear-gradient(135deg, var(--color-brand), var(--color-brand)); width: 100%;">
                  <i data-lucide="external-link"></i> Probar Portal
                </a>
              </div>
            </div>
          `;
        }).join('')}
      </div>
      
      <!-- Contenedor oculto temporal para generar Canvas QR -->
      <div id="hidden-qr-canvas-holder" style="display: none;"></div>
    `;

    // Vincular lógica de agregar sucursal
    const form = document.getElementById('add-location-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleAddLocation();
    });

    const openModalBtn = document.getElementById('open-req-modal');
    if (openModalBtn) {
      openModalBtn.addEventListener('click', () => this.handleRequestLocationModal());
    }

    // Vincular switches de activación inteligente
    document.querySelectorAll('.loc-toggle').forEach(chk => {
      chk.addEventListener('change', (e) => {
        const id = e.target.getAttribute('data-id');
        this.handleToggleLocation(id, e.target.checked);
      });
    });

    // Vincular generación y descarga de códigos QR
    document.querySelectorAll('.download-qr-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = btn.getAttribute('data-id');
        const name = btn.getAttribute('data-name');
        this.downloadQRCode(id, name);
      });
    });

    // Vincular impresión de habladores de mesa
    document.querySelectorAll('.print-qr-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = btn.getAttribute('data-id');
        const name = btn.getAttribute('data-name');
        this.printQRCode(id, name);
      });
    });

    // Vincular compartir enlace nativo
    document.querySelectorAll('.share-loc-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = btn.getAttribute('data-id');
        const name = btn.getAttribute('data-name');
        this.handleShareLocation(id, name);
      });
    });
    },

    handleShareLocation(id, name) {
    const portalUrl = `${window.location.origin}/#portal?id=${id}`;
    const shareData = {
      title: `Califica tu experiencia en ${name}`,
      text: `Hola, nos encantaría conocer tu opinión sobre ${name}. Puedes dejarnos tu reseña aquí:`,
      url: portalUrl
    };

    if (navigator.share) {
      navigator.share(shareData)
        .then(() => this.addLog('SYSTEM', `Enlace compartido con éxito: ${name}`))
        .catch((err) => console.log('Error compartiendo:', err));
    } else {
      // Fallback si no hay soporte nativo (Copiar al portapapeles)
      navigator.clipboard.writeText(portalUrl);
      alert('Tu navegador no soporta la función nativa de compartir. El enlace ha sido copiado al portapapeles.');
    }
  },

  renderLocations(container) {
    const user = this.State.currentUser;
    const userLocations = this.State.locations.filter(l => l.userId === user.id);

    container.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
        <h2 style="font-size: 1.4rem;" data-i18n="nav_locations">Mis Sucursales</h2>
        <button class="btn btn-primary" id="open-req-modal" style="width: auto; padding: 0 16px;">
          <i data-lucide="plus"></i> Solicitud Profesional
        </button>
      </div>

      <!-- Formulario Rápido (Solo locales directos) -->
      <div class="card" style="margin-bottom: 24px; border-top: 4px solid var(--color-brand);">
        <h3 class="card-title"><i data-lucide="map-pin"></i> Nueva Sede (Básica)</h3>
        <form id="add-location-form" style="display: flex; flex-direction: column; gap: 12px; margin-top: 12px;">
          <div class="form-group" style="margin-bottom:0;">
            <input type="text" id="new-loc-name" class="form-control" placeholder="Nombre (ej: Sede Norte)" required>
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <input type="text" id="new-loc-address" class="form-control" placeholder="Dirección Física" required>
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <input type="url" id="new-loc-maps" class="form-control" placeholder="Enlace Google Maps (URL)" required>
          </div>
          <button type="submit" class="btn btn-primary">
            <i data-lucide="save"></i> Registrar Sede
          </button>
        </form>
      </div>

      <!-- Listado de Sucursales -->
      <div class="locations-grid" id="locations-list">
        ${userLocations.map(loc => {
          const isActive = loc.status === 'active';
          return `
            <div class="card location-card" id="card-${loc.id}">
              <div class="location-header">
                <div class="location-info">
                  <h3>${loc.name}</h3>
                  <p><i data-lucide="map-pin"></i> ${loc.address}</p>
                </div>
                <!-- Badge interactivo de LED -->
                <span class="status-badge ${isActive ? 'active' : 'inactive'}" id="badge-${loc.id}">
                  <span class="led-dot"></span>
                  <span id="badge-text-${loc.id}">${this.t(isActive ? 'active' : 'inactive')}</span>
                </span>
              </div>

              <div style="display: flex; align-items: center; justify-content: space-between; padding-top: 12px; border-top: 1px solid var(--border-color); margin-top: 4px;">
                <span style="font-size: 0.85rem; color: var(--text-secondary);" data-i18n="loc_status_badge">Estado</span>
                <!-- Switch de Cambio de Estado al Instante -->
                <label class="switch-control">
                  <input type="checkbox" class="loc-toggle" data-id="${loc.id}" ${isActive ? 'checked' : ''}>
                  <span class="switch-slider"></span>
                </label>
              </div>

              <!-- Acciones de QR e Impresión -->
              <div class="location-actions">
                <button class="btn btn-secondary download-qr-btn" data-id="${loc.id}" data-name="${loc.name}" style="padding: 8px 12px; font-size: 0.8rem; border-radius: var(--radius-sm);">
                  <i data-lucide="download"></i> <span data-i18n="loc_download_qr">Hablador</span>
                </button>
                <button class="btn btn-secondary print-qr-btn" data-id="${loc.id}" data-name="${loc.name}" style="padding: 8px 12px; font-size: 0.8rem; border-radius: var(--radius-sm);">
                  <i data-lucide="printer"></i> Imprimir
                </button>
              </div>

              <!-- Acciones de Gestión (Editar/Borrar) -->
              <div class="location-actions">
                <button class="btn btn-secondary edit-loc-btn" data-id="${loc.id}" style="padding: 8px 12px; font-size: 0.8rem; border-radius: var(--radius-sm);">
                  <i data-lucide="edit"></i> Editar
                </button>
                <button class="btn btn-danger delete-loc-btn" data-id="${loc.id}" style="padding: 8px 12px; font-size: 0.8rem; border-radius: var(--radius-sm);">
                  <i data-lucide="trash-2"></i> Borrar
                </button>
              </div>

              <div style="margin-top: 8px; display: flex; flex-direction: column; gap: 8px;">
                <div style="display: flex; gap: 8px; width: 100%;">
                  <button class="btn btn-secondary" onclick="navigator.clipboard.writeText('${window.location.origin}/#portal?id=${loc.id}'); alert('Enlace de sucursal copiado');" style="flex: 1; padding: 8px 12px; font-size: 0.8rem; border-radius: var(--radius-sm);">
                    <i data-lucide="copy"></i> Copiar Enlace
                  </button>
                  <button class="btn btn-secondary share-loc-btn" data-id="${loc.id}" data-name="${loc.name}" style="flex: 1; padding: 8px 12px; font-size: 0.8rem; border-radius: var(--radius-sm);">
                    <i data-lucide="share-2"></i> Compartir
                  </button>
                </div>
                <a href="#portal?id=${loc.id}" target="_blank" class="btn btn-primary" style="padding: 8px 12px; font-size: 0.8rem; border-radius: var(--radius-sm); background: linear-gradient(135deg, var(--color-brand), var(--color-brand)); width: 100%;">
                  <i data-lucide="external-link"></i> Probar Portal
                </a>
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <!-- Contenedor oculto temporal para generar Canvas QR -->
      <div id="hidden-qr-canvas-holder" style="display: none;"></div>
    `;

    // Vincular lógica de agregar sucursal
    const form = document.getElementById('add-location-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleAddLocation();
      });
    }

    const openModalBtn = document.getElementById('open-req-modal');
    if (openModalBtn) {
      openModalBtn.addEventListener('click', () => this.handleRequestLocationModal());
    }

    // Vincular switches de activación inteligente
    document.querySelectorAll('.loc-toggle').forEach(chk => {
      chk.addEventListener('change', (e) => {
        const id = e.target.getAttribute('data-id');
        this.handleToggleLocation(id, e.target.checked);
      });
    });

    // Vincular generación y descarga de códigos QR
    document.querySelectorAll('.download-qr-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = btn.getAttribute('data-id');
        const name = btn.getAttribute('data-name');
        this.downloadQRCode(id, name);
      });
    });

    // Vincular impresión de habladores de mesa
    document.querySelectorAll('.print-qr-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = btn.getAttribute('data-id');
        const name = btn.getAttribute('data-name');
        this.printQRCode(id, name);
      });
    });

    // Vincular compartir enlace nativo
    document.querySelectorAll('.share-loc-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = btn.getAttribute('data-id');
        const name = btn.getAttribute('data-name');
        this.handleShareLocation(id, name);
      });
    });

    // Vincular botones de Editar
    document.querySelectorAll('.edit-loc-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        this.handleEditLocation(id);
      });
    });

    // Vincular botones de Borrar
    document.querySelectorAll('.delete-loc-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        this.handleDeleteLocation(id);
      });
    });
  },

  async handleAddLocation() {
    const user = this.State.currentUser;
    const name = document.getElementById('new-loc-name').value;
    const address = document.getElementById('new-loc-address').value;
    const mapsUrl = document.getElementById('new-loc-maps').value;

    if (supabaseClient) {
      this.addLog('POST', `Registrando sucursal en Supabase: ${name}`);
      const { data: newLoc, error } = await supabaseClient.from('locations').insert([{
        tenant_id: user.id,
        name: name,
        address: address,
        maps_url: mapsUrl,
        status: 'active'
      }]).select().single();

      if (error) {
        alert("Error al guardar local en Supabase: " + error.message);
        return;
      }

      await this.syncFromSupabase();
    } else {
      const newLoc = {
        id: `loc_${Date.now()}`,
        userId: user.id,
        name,
        address,
        mapsUrl,
        status: 'inactive'
      };

      this.State.locations.push(newLoc);
      this.saveLocations();
    }
    
    this.addLog('POST', `Nueva sucursal registrada por ${user.businessName}: ${name} (/api/locations)`);
    this.renderPageContent('locations');
  },

  async handleToggleLocation(id, shouldActivate) {
    const user = this.State.currentUser;
    const loc = this.State.locations.find(l => l.id === id);
    if (!loc) return;

    let targetStatus = shouldActivate ? 'active' : 'inactive';

    if (shouldActivate) {
      // Validar límites de sucursales según el plan del tenant logueado
      const userLocations = this.State.locations.filter(l => l.userId === user.id);
      const activeCount = userLocations.filter(l => l.status === 'active').length;
      const limit = this.PlanLimits[user.plan];

      if (activeCount >= limit) {
        alert(this.t('loc_limit_desc', { limit }));
        this.renderPageContent('locations');
        return;
      }
    }

    if (supabaseClient) {
      this.addLog('PUT', `Actualizando estado de sucursal en Supabase: ${loc.name} -> ${targetStatus}`);
      const { error } = await supabaseClient
        .from('locations')
        .update({ status: targetStatus })
        .eq('id', id);

      if (error) {
        alert("Error al actualizar sucursal en Supabase: " + error.message);
        this.renderPageContent('locations');
        return;
      }
      await this.syncFromSupabase();
    } else {
      loc.status = targetStatus;
      this.saveLocations();
    }

    this.addLog('PUT', `Sucursal ${targetStatus} de ${user.businessName}: "${loc.name}"`);

    // Actualizar dinámicamente el switch en pantalla
    const updatedLoc = this.State.locations.find(l => l.id === id);
    const badge = document.getElementById(`badge-${id}`);
    const badgeText = document.getElementById(`badge-text-${id}`);
    if (badge && badgeText && updatedLoc) {
      const isNowActive = updatedLoc.status === 'active';
      badge.className = isNowActive ? 'status-badge active' : 'status-badge inactive';
      badgeText.textContent = this.t(isNowActive ? 'active' : 'inactive');
    }
  },

  async handleEditLocation(id) {
    const loc = this.State.locations.find(l => l.id === id);
    if (!loc) return;

    const newName = prompt("Nuevo nombre de la sucursal:", loc.name);
    if (newName === null) return; // Cancelado

    const newAddress = prompt("Nueva dirección física:", loc.address);
    if (newAddress === null) return;

    const newMapsUrl = prompt("Nuevo enlace de Google Maps:", loc.mapsUrl);
    if (newMapsUrl === null) return;

    if (supabaseClient) {
      this.addLog('PUT', `Editando sucursal en Supabase: ${loc.name}`);
      const { error } = await supabaseClient
        .from('locations')
        .update({
          name: newName,
          address: newAddress,
          maps_url: newMapsUrl
        })
        .eq('id', id);

      if (error) {
        alert("Error al editar sucursal: " + error.message);
        return;
      }
      await this.syncFromSupabase();
    } else {
      loc.name = newName;
      loc.address = newAddress;
      loc.mapsUrl = newMapsUrl;
      this.saveLocations();
    }

    this.renderPageContent('locations');
  },

  async handleDeleteLocation(id) {
    const loc = this.State.locations.find(l => l.id === id);
    if (!loc) return;

    if (!confirm(`¿Estás seguro de que deseas eliminar la sucursal "${loc.name}"? Esta acción no se puede deshacer.`)) {
      return;
    }

    if (supabaseClient) {
      this.addLog('DELETE', `Eliminando sucursal en Supabase: ${loc.name}`);
      const { error } = await supabaseClient
        .from('locations')
        .delete()
        .eq('id', id);

      if (error) {
        alert("Error al eliminar sucursal: " + error.message);
        return;
      }
      await this.syncFromSupabase();
    } else {
      this.State.locations = this.State.locations.filter(l => l.id !== id);
      this.saveLocations();
    }

    this.renderPageContent('locations');
  },

  handleRequestLocationModal() {
    const user = this.State.currentUser;
    const modalHTML = `
      <div id="req-modal" class="checkout-modal active">
        <div class="checkout-sheet" style="max-height: 90vh; overflow-y: auto; padding-bottom: 40px;">
          <div class="checkout-header">
            <div class="checkout-brand">
              <i data-lucide="sparkles" style="color: var(--color-brand);"></i>
              <h3 style="font-size: 1.2rem;">Cuestionario de Sucursal</h3>
            </div>
            <button class="header-btn" onclick="document.getElementById('req-modal').remove()">
              <i data-lucide="x"></i>
            </button>
          </div>

          <form id="full-request-form" style="display: flex; flex-direction: column; gap: 15px; margin-top: 10px;">
            <div class="form-group">
              <label class="form-label">Nombre de la Nueva Sucursal</label>
              <input type="text" id="req-name" class="form-control" placeholder="Ej: Sede Norte Express" required>
            </div>
            <div class="form-group">
              <label class="form-label">Dirección Completa (con Ciudad)</label>
              <input type="text" id="req-address" class="form-control" placeholder="Carrera 45 # 10-20, Medellín" required>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Color de Marca (Hex)</label>
                <input type="color" id="req-color" class="form-control" value="#6366f1" style="height: 46px; padding: 5px;">
              </div>
              <div class="form-group">
                <label class="form-label">Teléfono de Contacto</label>
                <input type="tel" id="req-phone" class="form-control" placeholder="3001234567" required>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Nombre del Responsable en Sede</label>
              <input type="text" id="req-contact-name" class="form-control" placeholder="Carlos Mario" required>
            </div>
            <div class="form-group">
              <label class="form-label">Correo Electrónico de Notificaciones</label>
              <input type="email" id="req-email" class="form-control" placeholder="sede@tucomercio.com" required>
            </div>
            
            <div style="background: rgba(79, 70, 229, 0.05); padding: 12px; border-radius: 12px; border: 1px dashed var(--color-brand); font-size: 0.8rem; color: var(--color-brand);">
              <i data-lucide="info" style="width: 14px; height: 14px; display: inline; vertical-align: middle;"></i> Una vez enviada, crearemos tu módulo profesional y te avisaremos por WhatsApp.
            </div>

            <button type="submit" class="btn btn-primary" style="height: 50px;">
              <i data-lucide="send"></i> Enviar Solicitud de Creación
            </button>
          </form>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    lucide.createIcons();

    document.getElementById('full-request-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const payload = {
        tenant_id: user.id,
        business_name: user.businessName,
        contact_name: document.getElementById('req-contact-name').value,
        contact_email: document.getElementById('req-email').value,
        contact_phone: document.getElementById('req-phone').value,
        loc_name: document.getElementById('req-name').value,
        loc_address: document.getElementById('req-address').value,
        loc_accent_color: document.getElementById('req-color').value,
        status: 'pending'
      };

      if (supabaseClient) {
        const { error } = await supabaseClient.from('location_requests').insert([payload]);
        if (error) {
          alert("Error al enviar solicitud: " + error.message);
          return;
        }
        this.addLog('SYSTEM', `NUEVA SOLICITUD: ${user.businessName} solicitó creación de ${payload.loc_name}`);
      }

      alert("¡Solicitud recibida con éxito! La procesaremos de inmediato.");
      document.getElementById('req-modal').remove();
      this.syncFromSupabase();
    });
  },

  // Generador de Códigos QR de Alta Definición usando qrcode.min.js
  generateQRCodeCanvas(text, callback) {
    const holder = document.getElementById('hidden-qr-canvas-holder');
    if (!holder) return;
    holder.innerHTML = ''; 

    const canvas = document.createElement('canvas');
    holder.appendChild(canvas);

    // La librería en index.html es qrcode.min.js (npm qrcode), que usa QRCode.toCanvas
    QRCode.toCanvas(canvas, text, {
      width: 1024,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff'
      },
      errorCorrectionLevel: 'H'
    }, (error) => {
      if (error) {
        console.error("Error generando QR: ", error);
        return;
      }
      callback(canvas);
    });
  },

  downloadQRCode(id, name) {
    const portalUrl = `${window.location.origin}${window.location.pathname}#portal?id=${id}`;
    const user = this.State.currentUser;
    const logo = user.qrCustomImage || user.logo || '🚀';
    this.addLog('GET', `Generando Hablador para: "${name}"`);

    this.generateQRCodeCanvas(portalUrl, (qrCanvas) => {
      const finalCanvas = document.createElement('canvas');
      finalCanvas.width = 1200;
      finalCanvas.height = 1800;
      const ctx = finalCanvas.getContext('2d');

      // 1. Fondo y Sombra de Tarjeta
      ctx.fillStyle = '#f3f4f6'; // Color de fondo gris muy claro
      ctx.fillRect(0, 0, 1200, 1800);

      // Dibujar "Stand" blanco con bordes redondeados
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.1)';
      ctx.shadowBlur = 40;
      ctx.shadowOffsetY = 20;
      this.drawRoundedRect(ctx, 100, 100, 1000, 1600, 60);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.restore();

      const accent = user.qrAccentColor || '#6366f1';

      // 2. Cabecera (Header)
      ctx.save();
      // Clip para que el header siga la redondez superior
      this.drawRoundedRect(ctx, 100, 100, 1000, 400, 60);
      ctx.clip();
      const grad = ctx.createLinearGradient(0, 100, 0, 500);
      grad.addColorStop(0, accent);
      grad.addColorStop(1, accent + 'dd');
      ctx.fillStyle = grad;
      ctx.fillRect(100, 100, 1000, 400);
      
      // Texto "IMPULSA"
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 60px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('IMPULSA', 600, 450);
      ctx.restore();

      // 3. Nombres
      ctx.fillStyle = '#111827';
      ctx.font = 'bold 85px sans-serif';
      ctx.textAlign = 'center';
      // Ajuste de texto largo para el negocio
      let bName = user.businessName.toUpperCase();
      if (bName.length > 20) ctx.font = 'bold 65px sans-serif';
      ctx.fillText(bName, 600, 620);
      
      ctx.font = '600 55px sans-serif';
      ctx.fillStyle = accent;
      ctx.fillText(name, 600, 710);

      // 4. QR con Marco
      const qrSize = 750;
      const qrX = 600 - (qrSize / 2);
      const qrY = 820;

      // Marco del QR
      ctx.save();
      ctx.strokeStyle = accent + '11';
      ctx.lineWidth = 4;
      this.drawRoundedRect(ctx, qrX - 20, qrY - 20, qrSize + 40, qrSize + 40, 30);
      ctx.stroke();
      ctx.restore();

      ctx.drawImage(qrCanvas, qrX, qrY, qrSize, qrSize);

      // 5. Footer Decorativo
      ctx.fillStyle = accent;
      ctx.fillRect(100, 1680, 1000, 20);

      const finishAndDownload = async () => {
        // Texto del footer
        ctx.font = 'bold 50px sans-serif';
        ctx.fillStyle = '#374151';
        ctx.textAlign = 'center';
        ctx.fillText(user.qrFooterText || '¡Tu opinión nos ayuda a crecer!', 600, 1630);

        const dataUrl = finalCanvas.toDataURL("image/png");
        
        // Intentar compartir nativamente en móviles
        if (navigator.share && navigator.canShare) {
          try {
            const blob = await (await fetch(dataUrl)).blob();
            const file = new File([blob], `Hablador_${name.replace(/\s+/g, '_')}.png`, { type: 'image/png' });
            if (navigator.canShare({ files: [file] })) {
              await navigator.share({
                files: [file],
                title: 'Hablador QR IMPULSA',
                text: `QR para ${user.businessName} - ${name}`
              });
              return; // Si se compartió, no descargamos automáticamente
            }
          } catch (e) {
            console.warn("Fallo al compartir, procediendo a descarga normal.");
          }
        }

        // Descarga normal si no hay Share o falló
        const link = document.createElement('a');
        link.download = `Hablador_IMPULSA_${name.replace(/\s+/g, '_')}.png`;
        link.href = dataUrl;
        link.click();
      };

      // --- DIBUJAR LOGO EN CENTRO DEL QR Y CABECERA ---
      const centerX = 600;
      const centerY = qrY + (qrSize / 2);
      const logoSize = 180;

      const drawLogo = (img = null, isEmoji = false) => {
        // Logo en QR
        ctx.save();
        const bgSize = logoSize + 30;
        this.drawRoundedRect(ctx, centerX - (bgSize/2), centerY - (bgSize/2), bgSize, bgSize, 20);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.shadowColor = 'rgba(0,0,0,0.1)';
        ctx.shadowBlur = 10;
        ctx.stroke();

        if (isEmoji) {
          ctx.font = '120px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(logo, centerX, centerY + 10);
        } else {
          this.drawRoundedRect(ctx, centerX - (logoSize/2), centerY - (logoSize/2), logoSize, logoSize, 15);
          ctx.clip();
          ctx.drawImage(img, centerX - (logoSize/2), centerY - (logoSize/2), logoSize, logoSize);
        }
        ctx.restore();

        // Logo en Cabecera
        ctx.save();
        const hLogoSize = 140;
        const hLogoX = 600 - (hLogoSize / 2);
        const hLogoY = 180;
        
        this.drawRoundedRect(ctx, hLogoX, hLogoY, hLogoSize, hLogoSize, 25);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        
        if (isEmoji) {
          ctx.font = '90px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(logo, 600, hLogoY + (hLogoSize/2) + 5);
        } else {
          ctx.save();
          this.drawRoundedRect(ctx, hLogoX + 10, hLogoY + 10, hLogoSize - 20, hLogoSize - 20, 15);
          ctx.clip();
          ctx.drawImage(img, hLogoX + 10, hLogoY + 10, hLogoSize - 20, hLogoSize - 20);
          ctx.restore();
        }
        ctx.restore();

        finishAndDownload();
      };

      if (logo.startsWith('http') || logo.startsWith('data:image')) {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => drawLogo(img, false);
        img.onerror = () => drawLogo(null, true);
        img.src = logo;
      } else {
        drawLogo(null, true);
      }
    });
  },

  // Helper para dibujar rectángulos redondeados en Canvas
  drawRoundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  },

  printQRCode(id, name) {
    const portalUrl = `${window.location.origin}${window.location.pathname}#portal?id=${id}`;
    const user = this.State.currentUser;
    // Prioridad: Imagen personalizada de QR -> Logo del portal -> Emoji por defecto
    const logo = user.qrCustomImage || user.logo || '🏪';
    
    this.generateQRCodeCanvas(portalUrl, (canvas) => {
      const qrDataUrl = canvas.toDataURL("image/png");
      const printWindow = window.open('', '_blank');
      
      const accentColor = user.qrAccentColor || '#6366f1';
      const bgColor = user.qrBgColor || '#ffffff';
      const footerText = user.qrFooterText || '¡Tu opinión nos ayuda a crecer!';
      
      printWindow.document.write(`
        <html>
          <head>
            <title>Imprimir Hablador - ${user.businessName}</title>
            <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;700;800&display=swap" rel="stylesheet">
            <style>
              body {
                font-family: 'Outfit', sans-serif;
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                margin: 0;
                background-color: #f9fafb;
              }
              .stand {
                width: 450px;
                background: white;
                border-radius: 40px;
                overflow: hidden;
                box-shadow: 0 25px 50px -12px rgba(0,0,0,0.15);
                border: 1px solid #e5e7eb;
                text-align: center;
              }
              .header {
                background: linear-gradient(135deg, ${accentColor}, ${accentColor}dd);
                padding: 40px 20px;
                color: white;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 15px;
              }
              .business-logo {
                height: 100px;
                min-width: 100px;
                background: white;
                border-radius: 15px;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 10px;
                overflow: hidden;
                box-shadow: 0 8px 16px rgba(0,0,0,0.15);
              }
              .business-logo img {
                height: 100%;
                width: auto;
                object-fit: contain;
                border-radius: 8px;
              }
              .business-logo span {
                font-size: 3.5rem;
              }
              .brand-name {
                font-weight: 800;
                font-size: 1.4rem;
                letter-spacing: 1px;
                text-transform: uppercase;
              }
              .content {
                padding: 40px 30px;
                background-color: white;
              }
              .business-name-main {
                font-weight: 800;
                font-size: 2.2rem;
                color: #111827;
                margin-bottom: 5px;
                text-transform: uppercase;
              }
              .location-name {
                font-weight: 600;
                font-size: 1.2rem;
                color: ${accentColor};
                margin-bottom: 30px;
              }
              .qr-container {
                padding: 25px;
                background: white;
                border-radius: 35px;
                border: 3px solid ${accentColor}22;
                margin-bottom: 30px;
                display: inline-block;
                box-shadow: 0 4px 12px rgba(0,0,0,0.05);
                position: relative;
              }
              .qr-img {
                width: 260px;
                height: 260px;
                display: block;
              }
              .qr-center-logo {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                height: 60px;
                min-width: 60px;
                background: white;
                border-radius: 10px;
                padding: 5px;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 4px 10px rgba(0,0,0,0.1);
              }
              .qr-center-logo img {
                height: 100%;
                width: auto;
                object-fit: contain;
                border-radius: 5px;
              }
              .footer {
                padding: 25px;
                background: #f9fafb;
                border-top: 1px solid #f3f4f6;
              }
              .footer-text {
                font-weight: 800;
                font-size: 1.3rem;
                color: #111827;
              }
              .footer-decor {
                height: 20px;
                background: ${accentColor};
              }
              @media print {
                body { background: white; }
                .stand { box-shadow: none; border: 1px solid #eee; }
                .header { -webkit-print-color-adjust: exact; }
                .footer-decor { -webkit-print-color-adjust: exact; }
              }
            </style>
          </head>
          <body>
            <div class="stand">
              <div class="header">
                <div class="business-logo">
                  ${logo.startsWith('http') || logo.startsWith('data:image') ? `<img src="${logo}">` : logo}
                </div>
                <div class="brand-name">IMPULSA</div>
              </div>
              <div class="content">
                <div class="business-name-main">${user.businessName}</div>
                <div class="location-name">${name}</div>
                <div class="qr-container">
                  <img src="${qrDataUrl}" class="qr-img" />
                  <div class="qr-center-logo">
                    ${logo.startsWith('http') || logo.startsWith('data:image') ? `<img src="${logo}">` : `<span>${logo}</span>`}
                  </div>
                </div>
              </div>
              <div class="footer">
                <div class="footer-text">${footerText}</div>
              </div>
              <div class="footer-decor"></div>
            </div>
            <script>
              window.onload = function() {
                setTimeout(function() { window.print(); window.close(); }, 700);
              };
            </script>
          </body>
        </html>
      `);
      printWindow.document.close();
    });
  },

  // ==========================================================================
  // 🎨 PORTAL DE OPINIÓN CLIENTE (OpinionPortal) - Móvil-First Standalone View
  // ==========================================================================
  async renderOpinionPortal(locationId, prospectId = null) {
    let loc = null;
    let tenant = null;

    if (prospectId && supabaseClient) {
      // Caso: Previsualización de Prospecto de Mercadeo
      const { data: p, error } = await supabaseClient.from('marketing_prospects').select('*').eq('id', prospectId).single();
      if (p) {
        loc = { id: p.id, name: p.loc_name, address: p.loc_address, mapsUrl: p.loc_maps_url, status: 'active', userId: 'prospect' };
        tenant = { id: 'prospect', businessName: p.business_name, logo: p.logo, accentColor: p.accent_color, bgColor: '#ffffff', title: `Opiniones de ${p.business_name}` };
      }
    } else {
      // Caso: Portal Real de Cliente
      loc = this.State.locations.find(l => l.id === locationId);
      if (!loc && supabaseClient) {
        const { data, error } = await supabaseClient.from('locations').select('*').eq('id', locationId).single();
        if (data) {
          loc = { id: data.id, userId: data.tenant_id, name: data.name, address: data.address, mapsUrl: data.maps_url || '', status: data.status };
          this.State.locations.push(loc);
        }
      }
    }

    if (!loc) {
      document.body.innerHTML = `<div style="padding:40px; text-align:center;"><h2>Sucursal no encontrada o inactiva</h2></div>`;
      return;
    }

    // Buscar configuración de diseño del comercio (Tenant) si no es prospecto
    if (!tenant) {
      tenant = this.State.users.find(u => u.id === loc.userId);
      if (!tenant && supabaseClient) {
        const { data, error } = await supabaseClient.from('profiles').select('*').eq('id', loc.userId).single();
        if (data) {
          tenant = {
            id: data.id,
            businessName: data.business_name,
            logo: data.logo || '🏪',
            accentColor: data.accent_color || '#6366f1',
            bgColor: data.bg_color || '#ffffff',
            title: data.portal_title || `Opiniones de ${data.business_name}`
          };
          this.State.users.push(tenant);
        }
      }
    }

    if (!tenant) tenant = { logo: '🏪', accentColor: '#4F46E5', bgColor: '#ffffff', title: 'Portal de Opinión' };

    // El logo ahora es solo el del perfil del cliente
    const displayLogo = tenant.logo || '🏪';

    this.State.visits += 1; 
    this.addLog('GET', `Cliente final accedió al portal de: "${loc.name}" (Visitas: ${this.State.visits})`);

    const viewContainer = document.getElementById('app-view');
    if (!viewContainer) return;

    viewContainer.innerHTML = `
      <style>
        .portal-container .star-btn svg { stroke: ${tenant.accentColor || 'var(--color-brand)'}; opacity: 0.7; }
        .portal-container .star-btn.filled svg { fill: #FFD700; stroke: #FFD700; opacity: 1; }
        .portal-container .btn-primary { background: ${tenant.accentColor || 'var(--color-brand)'} !important; border: none; }
        .portal-container .btn-accent { background: ${tenant.accentColor || 'var(--color-accent)'} !important; border: none; }
      </style>
      <div class="portal-container" style="background-color: ${tenant.bgColor || '#ffffff'} !important; min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 20px;">
        <div class="card" style="box-shadow: var(--shadow-md); border-radius: var(--radius-lg); padding: 32px 20px; border-top: 6px solid ${tenant.accentColor || 'var(--color-brand)'}; background-color: white; width: 100%; max-width: 450px;">
          
          <div class="portal-brand">
            <div class="portal-logo-container" style="border-color: ${tenant.accentColor || 'var(--border-color)'}">
              <div style="font-size: 2.2rem; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; overflow: hidden; border-radius: 50%;">
                ${displayLogo.startsWith('http') ? `<img src="${displayLogo}" style="width:100%; height:100%; object-fit:cover;">` : displayLogo}
              </div>
            </div>
            <h2 class="portal-title">${tenant.title}</h2>
            <div style="font-size: 0.9rem; color: ${tenant.accentColor || 'var(--text-secondary)'}; margin-top: 4px; font-weight:700; text-transform: uppercase; letter-spacing: 1px;">${loc.name}</div>
          </div>

          <div id="portal-step-rating">
            <p class="portal-desc" data-i18n="port_welcome_desc">Tu opinión es sumamente importante para ayudarnos a mejorar cada día.</p>
            <h3 style="text-align: center; margin-top: 20px; font-size: 1.1rem;">
              <span data-i18n="port_welcome">¿Cómo fue tu experiencia en</span> ${loc.name}?
            </h3>

            <!-- 5 Estrellas de 60px Táctiles -->
            <div class="stars-container">
              ${Array.from({ length: 5 }).map((_, i) => `
                <button class="star-btn" data-index="${i + 1}">
                  <i data-lucide="star" style="width: 44px; height: 44px;"></i>
                </button>
              `).join('')}
            </div>
          </div>

          <!-- Caja de Respuesta Dinámica -->
          <div id="portal-step-feedback" class="stars-feedback-box" style="display: none;">
            <!-- Contenido dinámico -->
          </div>

        </div>
        
        <div style="text-align: center; font-size: 0.72rem; color: var(--text-secondary); margin-top: 16px;">
          Powered by <strong>IMPULSA</strong>
        </div>
      </div>
    `;

    this.translateInterface();

    const stars = document.querySelectorAll('.star-btn');
    let selectedRating = 0;

    stars.forEach(star => {
      star.addEventListener('click', () => {
        const rating = parseInt(star.getAttribute('data-index'));
        selectedRating = rating;
        
        stars.forEach(s => {
          const idx = parseInt(s.getAttribute('data-index'));
          s.classList.toggle('filled', idx <= rating);
        });

        this.handlePortalRatingSelected(locationId, loc, selectedRating, tenant);
      });
    });
  },

  handlePortalRatingSelected(locationId, loc, rating, tenant) {
    const feedbackBox = document.getElementById('portal-step-feedback');
    if (!feedbackBox) return;

    feedbackBox.style.display = 'block';

    if (rating === 5) {
      this.addLog('SYSTEM', `Estrategia: Cliente dio ${rating} estrellas a ${loc.name}. Redirigiendo a Google Maps...`);

      feedbackBox.innerHTML = `
        <div style="text-align: center; display: flex; flex-direction: column; gap: 16px;">
          <p style="font-size: 0.95rem; font-weight: 500;" data-i18n="port_stars_high">¡Qué gran alegría! Nos encanta saber que tuviste una experiencia espectacular...</p>
          
          <a href="${loc.mapsUrl}" target="_blank" id="maps-redirect-btn" class="btn btn-accent" style="font-size: 1.1rem; height: 50px; background: linear-gradient(135deg, ${tenant.accentColor || 'var(--color-accent)'}, #e09000);">
            <i data-lucide="map"></i>
            <span data-i18n="port_go_to_google">Publicar en Google Maps</span>
          </a>
        </div>
      `;

      this.shootConfetti();
      this.addLog('POST', `Redirección Google Maps completada para local: ${loc.name} (/api/locations/${locationId}/convert)`);

    } else {
      this.addLog('SYSTEM', `Estrategia: Cliente dio ${rating} estrellas a ${loc.name}. Mitigando en soporte interno.`);

      feedbackBox.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 14px;">
          <p style="font-size: 0.9rem; color: var(--text-secondary);" data-i18n="port_stars_low">Sentimos mucho que tu experiencia no haya sido la mejor...</p>
          
          <div class="form-group" style="margin-bottom: 0;">
            <label class="form-label" data-i18n="port_form_name">Nombre Completo</label>
            <input type="text" class="form-control" id="lead-name" required placeholder="Juan Perez">
          </div>
          
          <div class="form-group" style="margin-bottom: 0;">
            <label class="form-label" data-i18n="port_form_phone">Teléfono (WhatsApp)</label>
            <input type="tel" class="form-control" id="lead-phone" required placeholder="573105551234">
          </div>

          <div class="form-group" style="margin-bottom: 0;">
            <label class="form-label" data-i18n="port_form_comments">¿Qué podemos mejorar?</label>
            <textarea class="form-control" id="lead-comment" rows="3" required placeholder="Describe tu experiencia..."></textarea>
          </div>

          <button class="btn btn-primary" id="submit-lead-btn" style="height: 48px; background: ${tenant.accentColor || 'var(--color-brand)'}">
            <i data-lucide="send"></i>
            <span data-i18n="port_submit">Enviar Comentarios de Soporte</span>
          </button>
        </div>
      `;

      document.getElementById('submit-lead-btn').addEventListener('click', () => {
        this.submitPortalLead(locationId, loc.name, rating, loc.userId);
      });
    }

    this.translateInterface();
  },

  async submitPortalLead(locationId, locationName, rating, tenantId) {
    const nameInput = document.getElementById('lead-name');
    const phoneInput = document.getElementById('lead-phone');
    const commentInput = document.getElementById('lead-comment');

    if (!nameInput.value || !phoneInput.value || !commentInput.value) {
      alert(this.State.lang === 'es' ? 'Por favor completa todos los campos' : 'Please fill all fields');
      return;
    }

    const cleanPhone = phoneInput.value.replace(/\D/g, '');

    if (supabaseClient) {
      this.addLog('POST', `[Proxy Secure] Enviando lead de soporte a Supabase para: ${nameInput.value}`);
      
      const leadData = {
        tenant_id: tenantId,
        location_id: locationId,
        rating: rating,
        client_name: nameInput.value,
        client_phone: cleanPhone,
        comment: commentInput.value,
        status: 'pending'
      };

      const { error } = await supabaseClient.from('leads').insert([leadData]);

      if (error) {
        console.error("Error Supabase Leads:", error);
        alert("Error al enviar comentarios: " + error.message);
        return;
      }
      await this.syncFromSupabase();
    } else {
      const newLead = {
        id: `lead_${Date.now()}`,
        userId: tenantId,
        date: new Date().toISOString(),
        locationId,
        locationName,
        clientName: nameInput.value,
        clientPhone: cleanPhone,
        rating,
        comment: commentInput.value
      };

      this.State.leads.push(newLead);
      this.saveLeads();
    }

    this.addLog('POST', `[Proxy Secure] /api/support - Mitigando opinión baja de ${nameInput.value} para el Tenant ${tenantId}`);
    this.addLog('POST', `[Proxy Secure] Payload enviado al webhook de n8n exitosamente. Status: 200 OK.`);

    const container = document.querySelector('.portal-container .card');
    if (container) {
      container.innerHTML = `
        <div style="text-align: center; padding: 20px 0; display: flex; flex-direction: column; gap: 16px;">
          <div style="width: 64px; height: 64px; background-color: rgba(16, 185, 129, 0.15); color: var(--color-success); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto;">
            <i data-lucide="check" style="width: 32px; height: 32px;"></i>
          </div>
          <h2 data-i18n="port_success_title">¡Muchas gracias!</h2>
          <p style="font-size: 0.95rem; color: var(--text-secondary); line-height: 1.6;" data-i18n="port_success_desc_low">Tus comentarios han sido recibidos.</p>
          <a href="#home" class="btn btn-secondary" style="margin-top: 12px; height: 46px;">
            Volver a IMPULSA
          </a>
        </div>
      `;
      this.translateInterface();
    }
  },

  shootConfetti() {
    const container = document.getElementById('confetti-container');
    if (!container) return;

    const colors = ['#4F46E5', '#06B6D4', '#FFD700', '#10B981', '#ffffff'];

    for (let i = 0; i < 40; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.left = `${Math.random() * 100}vw`;
      piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animationDelay = `${Math.random() * 1.5}s`;
      piece.style.width = `${Math.random() * 6 + 6}px`;
      piece.style.height = piece.style.width;
      
      container.appendChild(piece);
      setTimeout(() => piece.remove(), 4000);
    }
  },

  // ==========================================================================
  // 📈 VISTA: REPORTES Y ANALÍTICA (StatisticsPage)
  // ==========================================================================
  renderStatistics(container) {
    const user = this.State.currentUser;
    const userLocations = this.State.locations.filter(l => l.userId === user.id);
    const userLocIds = userLocations.map(l => l.id);
    const userLeads = this.State.leads.filter(lead => userLocIds.includes(lead.locationId));

    const totalVisits = this.State.visits;
    const totalLeads = userLeads.length;
    const conversionRate = totalVisits > 0 ? Math.round(((totalVisits - totalLeads) / totalVisits) * 100) : 100;
    const avgRating = totalLeads > 0 
      ? (userLeads.reduce((acc, curr) => acc + curr.rating, 0) / totalLeads).toFixed(1)
      : '5.0';

    container.innerHTML = `
      <div style="margin-bottom: 24px;">
        <h2 style="font-size: 1.4rem;" data-i18n="stat_title">Analítica y Reportes Avanzados</h2>
        <p style="color: var(--text-secondary); font-size: 0.88rem;" data-i18n="stat_subtitle">Visualiza el rendimiento de tus sucursales y exporta reportes de leads.</p>
      </div>

      <!-- Filtros Estratégicos (Plan Star) -->
      <div class="card" style="padding: 16px; border: 1px solid var(--color-brand); background-color: rgba(79, 70, 229, 0.02);">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
          <i data-lucide="sparkles" style="color: var(--color-brand); width: 18px;"></i>
          <h3 style="font-size: 0.9rem; color: var(--color-brand); font-weight: 700;">Filtro Estratégico de Reseñas</h3>
          ${user.plan !== 'star' ? `<span style="font-size: 0.65rem; background: var(--color-brand); color: white; padding: 2px 6px; border-radius: 4px; text-transform: uppercase;">Premium Star</span>` : ''}
        </div>
        
        <div class="form-row" style="align-items: flex-end;">
          <div class="form-group" style="margin-bottom: 0;">
            <label class="form-label">Calificación mínima</label>
            <select class="form-control" id="filter-rating" ${user.plan !== 'star' ? 'disabled' : ''}>
              <option value="0">Todas las estrellas</option>
              <option value="5">Solo 5 estrellas ★</option>
              <option value="4">4 estrellas o menos</option>
              <option value="3">3 estrellas o menos (Críticas)</option>
              <option value="1">Solo 1 estrella (Urgentes)</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom: 0;">
            <label class="form-label">Sucursal específica</label>
            <select class="form-control" id="filter-location" ${user.plan !== 'star' ? 'disabled' : ''}>
              <option value="all">Todas las sedes</option>
              ${userLocations.map(l => `<option value="${l.id}">${l.name}</option>`).join('')}
            </select>
          </div>
        </div>
        
        ${user.plan !== 'star' ? `
          <div style="margin-top: 12px; font-size: 0.75rem; color: var(--text-secondary);">
            <i data-lucide="lock" style="width: 12px; height: 12px;"></i> Actualiza al <strong>Plan Star</strong> para desbloquear filtros de inteligencia competitiva.
          </div>
        ` : ''}
      </div>

      <!-- Filtros por Fechas -->
      <div class="card" style="padding: 16px;">
        <div class="form-row" style="align-items: flex-end;">
          <div class="form-group" style="margin-bottom: 0;">
            <label class="form-label" data-i18n="stat_date_start">Fecha de inicio</label>
            <input type="date" class="form-control" id="filter-start-date" value="2026-05-01">
          </div>
          <div class="form-group" style="margin-bottom: 0;">
            <label class="form-label" data-i18n="stat_date_end">Fecha final</label>
            <input type="date" class="form-control" id="filter-end-date" value="2026-05-31">
          </div>
        </div>
        
        <div style="margin-top: 14px;">
          <button class="btn btn-primary" id="export-csv-btn">
            <i data-lucide="file-spreadsheet"></i>
            <span data-i18n="stat_export_csv">Exportar Reporte (CSV)</span>
          </button>
        </div>
      </div>

      <!-- Métricas Resumen -->
      <div class="metrics-row">
        <div class="metric-card">
          <span class="metric-label" data-i18n="dash_total_reviews">Visitas</span>
          <div class="metric-value">${totalVisits}</div>
        </div>
        <div class="metric-card">
          <span class="metric-label" data-i18n="stat_conversion_rate">Conversión</span>
          <div class="metric-value">${conversionRate}%</div>
        </div>
        <div class="metric-card">
          <span class="metric-label" data-i18n="dash_avg_stars">Calificación Promedio</span>
          <div class="metric-value">${avgRating} ★</div>
        </div>
        <div class="metric-card">
          <span class="metric-label" data-i18n="stat_leads_count">Leads</span>
          <div class="metric-value">${totalLeads}</div>
        </div>
      </div>

      <!-- Gráfico SVG Premium Autoadaptable -->
      <div class="card">
        <h3 class="card-title" data-i18n="stat_monthly_evolution">Visitas Mensuales vs Opiniones Recibidas</h3>
        <div class="chart-container">
          <svg class="chart-svg" viewBox="0 0 500 200" preserveAspectRatio="none">
            <defs>
              <linearGradient id="chart-gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="var(--color-brand)" stop-opacity="0.4"/>
                <stop offset="100%" stop-color="var(--color-brand)" stop-opacity="0"/>
              </linearGradient>
            </defs>
            <line x1="0" y1="180" x2="500" y2="180" stroke="var(--border-color)" stroke-width="1.5" />
            <line x1="0" y1="100" x2="500" y2="100" stroke="var(--border-color)" stroke-width="1" stroke-dasharray="4,4" />
            <line x1="0" y1="20" x2="500" y2="20" stroke="var(--border-color)" stroke-width="1" stroke-dasharray="4,4" />
            
            <path class="chart-gradient-fill" d="M 0 180 L 0 140 L 100 110 L 200 130 L 300 70 L 400 90 L 500 40 L 500 180 Z" />
            <path class="chart-line" d="M 0 140 L 100 110 L 200 130 L 300 70 L 400 90 L 500 40" />
            <path class="chart-line" d="M 0 170 L 100 160 L 200 165 L 300 140 L 400 150 L 500 120" stroke="var(--color-accent)" stroke-width="2.5" />
            
            <circle class="chart-point" cx="0" cy="140" r="5" />
            <circle class="chart-point" cx="100" cy="110" r="5" />
            <circle class="chart-point" cx="200" cy="130" r="5" />
            <circle class="chart-point" cx="300" cy="70" r="5" />
            <circle class="chart-point" cx="400" cy="90" r="5" />
            <circle class="chart-point" cx="500" cy="40" r="5" />
          </svg>
        </div>
      </div>
    `;

    document.getElementById('export-csv-btn').addEventListener('click', () => {
      const ratingFilter = document.getElementById('filter-rating')?.value || "0";
      const locationFilter = document.getElementById('filter-location')?.value || "all";
      
      let finalLeads = userLeads;
      
      if (user.plan === 'star') {
        if (ratingFilter === "5") finalLeads = finalLeads.filter(l => l.rating === 5);
        if (ratingFilter === "4") finalLeads = finalLeads.filter(l => l.rating <= 4);
        if (ratingFilter === "3") finalLeads = finalLeads.filter(l => l.rating <= 3);
        if (ratingFilter === "1") finalLeads = finalLeads.filter(l => l.rating === 1);
        
        if (locationFilter !== "all") finalLeads = finalLeads.filter(l => l.locationId === locationFilter);
      }

      this.exportLeadsCSV(finalLeads);
    });
  },

  exportLeadsCSV(userLeads) {
    const startDate = document.getElementById('filter-start-date').value;
    const endDate = document.getElementById('filter-end-date').value;

    const filteredLeads = userLeads.filter(lead => {
      const date = lead.date.substring(0, 10);
      return date >= startDate && date <= endDate;
    });

    if (filteredLeads.length === 0) {
      alert(this.State.lang === 'es' ? 'No hay leads en el rango de fechas seleccionado.' : 'No leads found in the selected date range.');
      return;
    }

    const headers = ["ID", "Fecha", "Sucursal", "Cliente", "Telefono", "Calificacion", "Comentarios"];
    const rows = filteredLeads.map(lead => [
      lead.id,
      new Date(lead.date).toLocaleDateString(),
      lead.locationName,
      lead.clientName,
      lead.clientPhone,
      lead.rating,
      `"${lead.comment.replace(/"/g, '""')}"`
    ]);

    const csvContent = "data:text/csv;charset=utf-8,\uFEFF"
      + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Reporte_IMPULSA_${startDate}_a_${endDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  },

  // ==========================================================================
  // 💳 VISTA: SUSCRIPCIÓN COMERCIAL (BillingPage)
  // ==========================================================================
  renderBilling(container) {
    const user = this.State.currentUser;
    const activePlan = user.plan;

    container.innerHTML = `
      <div style="margin-bottom: 24px;">
        <h2 style="font-size: 1.4rem;" data-i18n="bill_title">Planes y Monetización Integrada</h2>
        <p style="color: var(--text-secondary); font-size: 0.88rem;" data-i18n="bill_subtitle">Selecciona el plan ideal para expandir tu estrategia de reputación.</p>
      </div>

      <div style="padding: 12px 16px; border-radius: var(--radius-md); background-color: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.2); margin-bottom: 24px; font-size: 0.9rem;">
        <span data-i18n="bill_current_plan">Plan Actual:</span>
        <strong style="color: var(--color-success);">
          ${this.t(activePlan === 'free' ? 'bill_plan_free' : activePlan === 'pro' ? 'bill_plan_pro' : 'bill_plan_star')}
        </strong>
      </div>

      <div class="pricing-tabs">
        ${Object.entries(this.plansConfig).map(([key, plan]) => `
          <div class="pricing-card ${activePlan === key ? 'featured' : ''}">
            ${activePlan === key ? `<span class="pricing-featured-badge" data-i18n="bill_active_tag">Activo</span>` : ''}
            <div class="pricing-header">
              <h3>${plan.name}</h3>
              <span style="font-size: 0.8rem; color: var(--text-secondary);">
                ${plan.limit === Infinity ? 'Sucursales ilimitadas' : `Límite: ${plan.limit} ${plan.limit === 1 ? 'sucursal' : 'sucursales'}`}
              </span>
            </div>
            <div class="pricing-price">
              ${plan.price === 0 ? 'Gratis' : `${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(plan.price)} COP / mes`}
            </div>
            <ul class="pricing-features-list">
              ${plan.features.map(f => `<li><i data-lucide="check"></i> <span>${f}</span></li>`).join('')}
            </ul>
            <button class="btn ${key === 'star' ? 'btn-accent' : key === 'pro' ? 'btn-primary' : 'btn-secondary'} upgrade-plan-trigger" 
                    data-plan="${key}" 
                    ${activePlan === key ? 'disabled style="background:var(--bg-primary); color:var(--text-secondary); cursor:default; box-shadow:none;"' : ''}>
              ${activePlan === key ? 'Plan Activo' : 'Seleccionar Plan'}
            </button>
          </div>
        `).join('')}
      </div>
    `;

    document.querySelectorAll('.upgrade-plan-trigger').forEach(btn => {
      btn.addEventListener('click', () => {
        const plan = btn.getAttribute('data-plan');
        this.openCheckoutModal(plan);
      });
    });
  },

  async renderBillingResponse(container, params) {
    const transactionId = params.get('id');
    const status = transactionId ? 'approved' : 'pending';
    const user = this.State.currentUser;
    
    // Si hay un ID de transacción, intentamos actualizar el plan en Supabase (Simulando validación de webhook)
    if (transactionId && supabaseClient) {
      const pendingPlan = Storage.getItem('pending_plan_upgrade');
      const user = this.State.currentUser;
      
      if (pendingPlan && user) {
        this.addLog('SYSTEM', `Confirmando actualización al plan ${pendingPlan.toUpperCase()} para transacción: ${transactionId}`);
        
        try {
          // Calcular fecha de vencimiento (Meses seleccionados en el checkout)
          const months = user.subscription_period || 1;
          const expiryDate = new Date();
          expiryDate.setMonth(expiryDate.getMonth() + months);

          await supabaseClient.from('profiles').update({ 
            plan: pendingPlan,
            subscription_date: new Date().toISOString(),
            subscription_expiry: expiryDate.toISOString(),
            free_trial_used: true // Si paga, ya no tiene derecho a prueba gratuita futura
          }).eq('id', user.id);
          
          Storage.removeItem('pending_plan_upgrade');
          await this.syncFromSupabase();
        } catch (err) {
          console.error("Error actualizando plan tras pago:", err);
        }
      }
    }
    
    container.innerHTML = `
      <div style="max-width: 600px; margin: 40px auto; text-align: center; padding: 20px;">
        <div class="card" style="padding: 40px 20px; border-top: 8px solid ${status === 'approved' ? 'var(--color-success)' : 'var(--color-warning)'};">
          <div style="font-size: 4rem; margin-bottom: 20px;">
            ${status === 'approved' ? '✅' : '⏳'}
          </div>
          <h2 style="font-size: 1.8rem; margin-bottom: 10px;">
            ${status === 'approved' ? '¡Pago Procesado Exitosamente!' : 'Estamos procesando tu pago'}
          </h2>
          <p style="color: var(--text-secondary); line-height: 1.6; margin-bottom: 30px;">
            ${status === 'approved' 
              ? `Gracias por confiar en <strong>IMPULSA</strong>. Tu plan ha sido actualizado y ya puedes disfrutar de todas las funcionalidades premium para potenciar la reputación de tu negocio.` 
              : `Tu transacción se encuentra en estado pendiente. Una vez que Wompi confirme el pago, tu plan se actualizará automáticamente en los próximos minutos.`}
          </p>
          
          <div style="background: var(--bg-primary); padding: 20px; border-radius: 12px; margin-bottom: 30px; text-align: left; font-size: 0.9rem;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
              <span style="color: var(--text-secondary);">Comercio:</span>
              <strong>${user.businessName}</strong>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
              <span style="color: var(--text-secondary);">Transacción ID:</span>
              <strong style="font-family: monospace;">${params.get('id') || 'N/A'}</strong>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span style="color: var(--text-secondary);">Referencia:</span>
              <strong style="font-family: monospace;">${params.get('env') || 'IMPULSA-' + Date.now()}</strong>
            </div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 12px;">
            <a href="#dashboard" class="btn btn-primary">
              <i data-lucide="layout-dashboard"></i> Ir a mi Panel
            </a>
            <a href="#billing" class="btn btn-secondary">
              <i data-lucide="credit-card"></i> Ver mi Suscripción
            </a>
          </div>
        </div>
        
        <p style="margin-top: 24px; font-size: 0.8rem; color: var(--text-secondary);">
          Si tienes algún problema con tu pago, por favor contáctanos a soporte@impulsa.app mencionando tu ID de transacción.
        </p>
      </div>
    `;
    
    lucide.createIcons();
    this.addLog('SYSTEM', `Cliente redirigido desde Wompi. Estado detectado: ${status.toUpperCase()}. ID: ${params.get('id') || 'Ninguno'}`);
  },

  openCheckoutModal(plan) {
    const modal = document.getElementById('checkout-modal');
    if (!modal) return;

    modal.classList.add('active');

    const confirmBtn = document.getElementById('confirm-payment-btn');
    const formContainer = document.getElementById('checkout-form-container');
    const processingContainer = document.getElementById('checkout-processing-container');

    formContainer.style.display = 'block';
    processingContainer.style.display = 'none';

    const handler = async () => {
      const period = parseInt(document.getElementById('subscription-period').value);
      const basePriceCop = this.plansConfig[plan].price;
      const discounts = { 1: 0, 3: 0.05, 6: 0.1, 9: 0.15, 12: 0.2 };
      
      const totalAmountCop = (basePriceCop * period * (1 - discounts[period]));
      
      // MONTO ESTRICTO: Sin decimales para evitar fallos en la firma
      const amountInCents = Math.floor(totalAmountCop * 100);
      
      formContainer.style.display = 'none';
      processingContainer.style.display = 'block';

      // REFERENCIA ÚNICA: Añadimos un sufijo aleatorio para evitar errores de duplicidad en Sandbox
      const randomSuffix = Math.random().toString(36).substring(7).toUpperCase();
      const reference = `IMP-${Date.now()}-${randomSuffix}`.trim();
      
      const publicKey = (this.State.wompiConfig.publicKey || '').trim();
      const integritySecret = (this.State.wompiConfig.integritySecret || '').trim();
      
      if (!publicKey || !integritySecret) {
        alert("Error: Falta configurar la Llave Pública o el Secreto de Integridad en el Panel Admin.");
        modal.classList.remove('active');
        return;
      }

      // GENERACIÓN DE FIRMA SHA256 (ORDEN ESTRICTO: referencia + monto_en_centavos + moneda + secreto)
      const cadenaConcatenada = `${reference}${amountInCents}COP${integritySecret}`;
      
      console.log("=== WOMPI SIGNATURE DEBUG ===");
      console.log("Cadena a firmar (Secreto oculto):", `${reference}${amountInCents}COP***`);
      try {
        const encondedText = new TextEncoder().encode(cadenaConcatenada);
        const hashBuffer = await crypto.subtle.digest("SHA-256", encondedText);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        signature = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
      } catch (err) { 
        console.error("Error SHA:", err); 
      }

      console.log("=== WOMPI MOBILE DEBUG ===");
      console.log("Referencia:", reference);
      console.log("Monto Cents:", amountInCents);
      console.log("Firma:", signature);

      if (typeof WidgetCheckout === 'undefined') {
        alert("El sistema de pago aún se está cargando. Espera un segundo e intenta de nuevo.");
        return;
      }

      const checkout = new WidgetCheckout({
        currency: 'COP',
        amountInCents: amountInCents,
        reference: reference,
        publicKey: publicKey,
        signature: { integrity: signature },
        redirectUrl: `${window.location.origin}${window.location.pathname}?pay_res=success`,
        customerData: {
          email: this.State.currentUser.email,
          fullName: this.State.currentUser.fullName || this.State.currentUser.businessName,
          phoneNumber: this.State.currentUser.whatsapp || '',
          phoneNumberPrefix: '+57'
        }
      });

      Storage.setItem('pending_plan_upgrade', plan);
      
      if (supabaseClient) {
        await supabaseClient.from('profiles').update({ 
          last_payment_amount: totalAmountCop,
          subscription_period: period
        }).eq('id', this.State.currentUser.id);
      }

      checkout.open((result) => {
        if (result.transaction) {
          window.location.href = `${window.location.origin}${window.location.pathname}?pay_res=success&id=${result.transaction.id}`;
        }
      });

      modal.classList.remove('active');
      confirmBtn.removeEventListener('click', handler);
    };

    confirmBtn.addEventListener('click', handler);
  },

  // ==========================================================================
  // 🛡️ VISTA: PANEL EXCLUSIVO DEL SUPER ADMINISTRADOR (AdminDashboardPage)
  // ==========================================================================
  renderAdminDashboard(container) {
    if (!this.State.isSuperAdmin) {
      // Mostrar pantalla de Acceso Restringido Súper Admin
      container.innerHTML = `
        <div class="card restrict-box" style="border-top: 6px solid var(--color-danger);">
          <div class="restrict-icon">🔑</div>
          <h2 data-i18n="admin_restrict_title">Acceso Restringido Súper Admin</h2>
          <p style="font-size:0.88rem; color:var(--text-secondary); margin-top:8px;" data-i18n="admin_restrict_desc">Esta sección es de uso exclusivo para los administradores de la plataforma IMPULSA.</p>
          
          <form id="superadmin-auth-form" style="margin-top:20px; display:flex; flex-direction:column; gap:12px;">
            <div class="form-group" style="margin-bottom:0; text-align:left;">
              <label class="form-label" data-i18n="admin_restrict_user_label">Correo electrónico del Administrador</label>
              <input type="email" class="form-control" id="superadmin-email" required placeholder="admin@impulsa.com">
            </div>
            <div class="form-group" style="margin-bottom:0; text-align:left;">
              <label class="form-label" data-i18n="admin_restrict_pass_label">Contraseña de Super Admin</label>
              <input type="password" class="form-control" id="superadmin-pass" required placeholder="••••••••">
            </div>
            <button type="submit" class="btn btn-danger" style="height:44px;" data-i18n="admin_restrict_btn">
              Ingresar como Super Admin
            </button>
          </form>
        </div>
      `;

      // Vincular autenticación de Super Admin
      document.getElementById('superadmin-auth-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('superadmin-email').value;
        const pass = document.getElementById('superadmin-pass').value;
        
        if (email === 'admin@impulsa.com' && pass === 'Estrella2026+') {
          // Intentar login REAL en Supabase para obtener sesión y saltar RLS
          if (supabaseClient) {
            this.addLog('SYSTEM', 'Super Admin: Iniciando sesión en Supabase Auth...');
            const { error } = await supabaseClient.auth.signInWithPassword({ email, password: pass });
            if (error) {
              this.addLog('SYSTEM', `Error de Auth Supabase para Admin: ${error.message}`);
              // Continuamos de todos modos con bypass local, pero RLS podría fallar si no hay sesión
            }
          }

          this.State.isSuperAdmin = true;
          this.State.currentUser = null; // Quitar sesión de comercio
          Storage.setItem('impulsa_is_superadmin', 'true');
          Storage.setItem('impulsa_active_user', 'admin_bypass');
          
          this.addLog('SYSTEM', 'Acceso concedido a Súper Administrador global de IMPULSA.');
          
          if (supabaseClient) {
            await this.syncFromSupabase();
          }
          
          this.renderPageContent('admin');
          this.updateNavigationUI();
        } else {
          alert(this.State.lang === 'es' ? 'Contraseña incorrecta de prueba' : 'Incorrect test password');
        }
      });
      return;
    }

    // Si es Super Admin, renderizar el Panel Global de Auditoría
    container.innerHTML = `
      <div style="margin-bottom: 24px;">
        <h2 style="font-size: 1.4rem;" data-i18n="admin_title">Panel de Auditoría del Super Administrador</h2>
        <p style="color: var(--text-secondary); font-size: 0.88rem;" data-i18n="admin_subtitle">Control global de la plataforma, leads de todos los clientes y servidor seguro proxy.</p>
      </div>

      <div class="admin-tabs">
        <button class="admin-tab-btn active" data-tab="leads"><i data-lucide="message-square"></i> <span data-i18n="admin_leads_tab">Opiniones Globales</span></button>
        <button class="admin-tab-btn" data-tab="marketing"><i data-lucide="megaphone"></i> <span>Mercadeo</span></button>
        <button class="admin-tab-btn" data-tab="requests"><i data-lucide="sparkles"></i> <span>Solicitudes</span></button>
        <button class="admin-tab-btn" data-tab="tenants"><i data-lucide="users"></i> <span data-i18n="admin_users_tab">Cuentas de Comercios</span></button>
        <button class="admin-tab-btn" data-tab="plans"><i data-lucide="credit-card"></i> <span>Gestionar Planes</span></button>
        <button class="admin-tab-btn" data-tab="terminal"><i data-lucide="terminal"></i> <span data-i18n="admin_logs_tab">Consola de Servidor</span></button>
      </div>

      <div id="admin-tab-content">
        <!-- Cargado dinámicamente -->
      </div>
    `;

    document.querySelectorAll('.admin-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.getAttribute('data-tab');
        this.renderSuperAdminTabContent(tab);
      });
    });

    this.renderSuperAdminTabContent('leads');
  },

  renderSuperAdminTabContent(tab) {
    const tabContent = document.getElementById('admin-tab-content');
    if (!tabContent) return;

    if (tab === 'leads') {
      this.addLog('GET', `Súper Admin: Cargando listado global de leads (/api/admin/leads)`);
      
      const uniqueBusinesses = [...new Set(this.State.leads.map(l => l.businessName))].sort();
      
      tabContent.innerHTML = `
        <div class="card" style="margin-bottom: 20px; padding: 15px; background: rgba(0,123,255,0.02);">
          <div style="display: flex; gap: 15px; flex-wrap: wrap; align-items: flex-end;">
            <div class="form-group" style="margin-bottom: 0; flex: 1; min-width: 200px;">
              <label class="form-label" style="font-size: 0.75rem; margin-bottom: 4px;">Filtrar por Comercio</label>
              <select class="form-control" id="admin-filter-business" style="height: 38px; font-size: 0.85rem;">
                <option value="all">Todos los Comercios</option>
                ${uniqueBusinesses.map(b => `<option value="${b}">${b}</option>`).join('')}
              </select>
            </div>
            <div class="form-group" style="margin-bottom: 0; flex: 1; min-width: 200px;">
              <label class="form-label" style="font-size: 0.75rem; margin-bottom: 4px;">Filtrar por Sucursal</label>
              <select class="form-control" id="admin-filter-location" style="height: 38px; font-size: 0.85rem;">
                <option value="all">Todas las Sucursales</option>
              </select>
            </div>
          </div>
        </div>

        <div class="leads-table-container">
          <table class="leads-table" id="admin-leads-table">
            <thead>
              <tr>
                <th data-i18n="admin_table_date">Fecha</th>
                <th data-i18n="admin_table_business">Comercio</th>
                <th data-i18n="admin_table_loc">Sucursal</th>
                <th data-i18n="admin_table_client">Cliente</th>
                <th data-i18n="admin_table_rating">Valoración</th>
                <th data-i18n="admin_table_comment">Comentarios</th>
                <th data-i18n="admin_table_action">Contacto</th>
              </tr>
            </thead>
            <tbody id="admin-leads-tbody">
              ${this.renderAdminLeadsRows(this.State.leads)}
            </tbody>
          </table>
        </div>
      `;

      const businessSelect = document.getElementById('admin-filter-business');
      const locationSelect = document.getElementById('admin-filter-location');
      const tbody = document.getElementById('admin-leads-tbody');

      businessSelect.addEventListener('change', () => {
        const business = businessSelect.value;
        
        // Actualizar opciones de sucursal
        const locations = business === 'all' 
          ? [] 
          : [...new Set(this.State.leads.filter(l => l.businessName === business).map(l => l.locationName))].sort();
        
        locationSelect.innerHTML = '<option value="all">Todas las Sucursales</option>' + 
          locations.map(l => `<option value="${l}">${l}</option>`).join('');
        
        this.filterAdminLeads();
      });

      locationSelect.addEventListener('change', () => this.filterAdminLeads());

      lucide.createIcons();
    } else if (tab === 'marketing') {
      this.addLog('GET', `Súper Admin: Módulo de Mercadeo y Prospectos`);
      tabContent.innerHTML = `
        <div class="card" style="margin-bottom: 24px; border-top: 4px solid var(--color-accent);">
          <h3 class="card-title"><i data-lucide="upload-cloud"></i> Carga Masiva de Prospectos</h3>
          <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 15px;">
            Sube un archivo CSV con la información de los comercios para pre-construir sus portales automáticamente.<br>
            <strong>Formato:</strong> NombreNegocio, LogoUrl/Emoji, ColorHex, NombreContacto, WhatsApp, NombreSucursal, Direccion, MapsUrl
          </p>
          <div style="display: flex; gap: 10px; align-items: center;">
            <input type="file" id="marketing-csv-upload" accept=".csv" class="form-control" style="flex: 1;">
            <button class="btn btn-primary" id="process-marketing-csv" style="width: auto; padding: 0 20px;">
              <i data-lucide="play"></i> Procesar CSV
            </button>
          </div>
        </div>

        <div class="leads-table-container">
          <table class="leads-table" id="prospects-table">
            <thead>
              <tr>
                <th>Comercio (Prospecto)</th>
                <th>Sucursal Pre-construida</th>
                <th>Contacto</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody id="prospects-body">
              <tr><td colspan="5" style="text-align:center; padding:20px;">Cargando prospectos...</td></tr>
            </tbody>
          </table>
        </div>
      `;

      // Cargar prospectos de Supabase
      this.loadMarketingProspects();

      // Vincular procesamiento de CSV
      document.getElementById('process-marketing-csv').addEventListener('click', () => this.handleMarketingCSV());
    }
  },

  renderAdminLeadsRows(leads) {
    if (leads.length === 0) {
      return '<tr><td colspan="7" style="text-align:center; padding:30px; color:var(--text-secondary);">No se encontraron opiniones con los filtros seleccionados.</td></tr>';
    }
    return leads.map(lead => `
      <tr>
        <td style="white-space: nowrap; font-size: 0.8rem;">${new Date(lead.date).toLocaleDateString()}</td>
        <td style="font-weight: 700; color: var(--color-brand);">${lead.businessName}</td>
        <td style="font-weight: 500;">${lead.locationName}</td>
        <td><strong>${lead.clientName}</strong></td>
        <td style="color: #FFD700; font-weight: 700;">${lead.rating} ★</td>
        <td style="font-size: 0.85rem; color: var(--text-secondary); max-width: 250px;">${lead.comment}</td>
        <td>
          <a href="https://wa.me/${lead.clientPhone}?text=Hola+${encodeURIComponent(lead.clientName)},+hemos+recibido+tus+comentarios+en+${encodeURIComponent(lead.locationName)}..." target="_blank" class="btn btn-primary" style="padding: 6px 12px; font-size: 0.75rem; width: auto; background: linear-gradient(135deg, #25D366, #128C7E); box-shadow:none;">
            <i data-lucide="phone"></i> <span data-i18n="admin_wa_link">Contactar</span>
          </a>
        </td>
      </tr>
    `).join('');
    },

    filterAdminLeads() {
    const business = document.getElementById('admin-filter-business').value;
    const location = document.getElementById('admin-filter-location').value;
    const tbody = document.getElementById('admin-leads-tbody');

    let filtered = this.State.leads;
    if (business !== 'all') {
      filtered = filtered.filter(l => l.businessName === business);
    }
    if (location !== 'all') {
      filtered = filtered.filter(l => l.locationName === location);
    }

    tbody.innerHTML = this.renderAdminLeadsRows(filtered);
    lucide.createIcons();
    },

    renderSuperAdminTabContent(tab) {
    const tabContent = document.getElementById('admin-tab-content');
    if (!tabContent) return;

    if (tab === 'leads') {
      this.addLog('GET', `Súper Admin: Cargando listado global de leads (/api/admin/leads)`);

      const uniqueBusinesses = [...new Set(this.State.leads.map(l => l.businessName))].sort();

      tabContent.innerHTML = `
        <div class="card" style="margin-bottom: 20px; padding: 15px; background: rgba(0,123,255,0.02);">
          <div style="display: flex; gap: 15px; flex-wrap: wrap; align-items: flex-end;">
            <div class="form-group" style="margin-bottom: 0; flex: 1; min-width: 200px;">
              <label class="form-label" style="font-size: 0.75rem; margin-bottom: 4px;">Filtrar por Comercio</label>
              <select class="form-control" id="admin-filter-business" style="height: 38px; font-size: 0.85rem;">
                <option value="all">Todos los Comercios</option>
                ${uniqueBusinesses.map(b => `<option value="${b}">${b}</option>`).join('')}
              </select>
            </div>
            <div class="form-group" style="margin-bottom: 0; flex: 1; min-width: 200px;">
              <label class="form-label" style="font-size: 0.75rem; margin-bottom: 4px;">Filtrar por Sucursal</label>
              <select class="form-control" id="admin-filter-location" style="height: 38px; font-size: 0.85rem;">
                <option value="all">Todas las Sucursales</option>
              </select>
            </div>
          </div>
        </div>

        <div class="leads-table-container">
          <table class="leads-table" id="admin-leads-table">
            <thead>
              <tr>
                <th data-i18n="admin_table_date">Fecha</th>
                <th data-i18n="admin_table_business">Comercio</th>
                <th data-i18n="admin_table_loc">Sucursal</th>
                <th data-i18n="admin_table_client">Cliente</th>
                <th data-i18n="admin_table_rating">Valoración</th>
                <th data-i18n="admin_table_comment">Comentarios</th>
                <th data-i18n="admin_table_action">Contacto</th>
              </tr>
            </thead>
            <tbody id="admin-leads-tbody">
              ${this.renderAdminLeadsRows(this.State.leads)}
            </tbody>
          </table>
        </div>
      `;

      const businessSelect = document.getElementById('admin-filter-business');
      const locationSelect = document.getElementById('admin-filter-location');

      businessSelect.addEventListener('change', () => {
        const business = businessSelect.value;
        const locations = business === 'all' 
          ? [] 
          : [...new Set(this.State.leads.filter(l => l.businessName === business).map(l => l.locationName))].sort();

        locationSelect.innerHTML = '<option value="all">Todas las Sucursales</option>' + 
          locations.map(l => `<option value="${l}">${l}</option>`).join('');

        this.filterAdminLeads();
      });

      locationSelect.addEventListener('change', () => this.filterAdminLeads());
      lucide.createIcons();

    } else if (tab === 'marketing') {
      this.addLog('GET', `Súper Admin: Módulo de Mercadeo y Prospectos`);
      tabContent.innerHTML = `
        <div class="card" style="margin-bottom: 24px; border-top: 4px solid var(--color-accent);">
          <h3 class="card-title"><i data-lucide="upload-cloud"></i> Carga Masiva de Prospectos</h3>
          <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 15px;">
            Sube un archivo CSV con la información de los comercios para pre-construir sus portales automáticamente.<br>
            <strong>Formato:</strong> NombreNegocio, LogoUrl/Emoji, ColorHex, NombreContacto, WhatsApp, NombreSucursal, Direccion, MapsUrl
          </p>
          <div style="display: flex; gap: 10px; align-items: center;">
            <input type="file" id="marketing-csv-upload" accept=".csv" class="form-control" style="flex: 1;">
            <button class="btn btn-primary" id="process-marketing-csv" style="width: auto; padding: 0 20px;">
              <i data-lucide="play"></i> Procesar CSV
            </button>
          </div>
        </div>

        <div class="leads-table-container">
          <table class="leads-table" id="prospects-table">
            <thead>
              <tr>
                <th>Comercio (Prospecto)</th>
                <th>Sucursal Pre-construida</th>
                <th>Contacto</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody id="prospects-body">
              <tr><td colspan="5" style="text-align:center; padding:20px;">Cargando prospectos...</td></tr>
            </tbody>
          </table>
        </div>
      `;
      this.loadMarketingProspects();
      document.getElementById('process-marketing-csv').addEventListener('click', () => this.handleMarketingCSV());

    } else if (tab === 'requests') {
      this.addLog('GET', `Súper Admin: Revisando solicitudes de creación profesional`);
      tabContent.innerHTML = `
        <div class="leads-table-container">
          <table class="leads-table">
            <thead>
              <tr>
                <th>Comercio</th>
                <th>Datos Nueva Sucursal</th>
                <th>Responsable Sede</th>
                <th>Estado</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              ${this.State.locationRequests.length === 0 ? '<tr><td colspan="5" style="text-align:center; padding:20px;">No hay solicitudes pendientes.</td></tr>' : ''}
              ${this.State.locationRequests.map(r => `
                <tr>
                  <td>
                    <strong>${r.businessName}</strong><br>
                    <span style="font-size:0.75rem; color:var(--text-secondary);">${new Date(r.date).toLocaleDateString()}</span>
                  </td>
                  <td>
                    <div style="display:flex; flex-direction:column; gap:2px;">
                      <strong>${r.locName}</strong>
                      <span style="font-size:0.8rem; color:var(--text-secondary);"><i data-lucide="map-pin" style="width:12px; height:12px;"></i> ${r.locAddress}</span>
                      <div style="display:flex; align-items:center; gap:5px; font-size:0.75rem;">
                        <span style="width:12px; height:12px; background:${r.locAccentColor}; border-radius:3px;"></span> Color: ${r.locAccentColor}
                      </div>
                    </div>
                  </td>
                  <td>
                    <strong>${r.contactName}</strong><br>
                    <span style="font-size:0.8rem;">${r.contactEmail}</span><br>
                    <a href="https://wa.me/${r.contactPhone}" target="_blank" style="color:var(--color-success); font-size:0.8rem; text-decoration:none;">
                      <i data-lucide="message-circle" style="width:12px; height:12px;"></i> ${r.contactPhone}
                    </a>
                  </td>
                  <td>
                    <span class="status-badge ${r.status === 'pending' ? 'inactive' : 'active'}" style="font-size:0.7rem;">${r.status.toUpperCase()}</span>
                  </td>
                  <td>
                    ${r.status === 'pending' ? `
                      <button class="btn btn-primary create-from-req-btn" data-id="${r.id}" style="padding:6px 12px; font-size:0.75rem; width:auto;">
                        <i data-lucide="plus"></i> Crear Sucursal
                      </button>
                    ` : '<span style="color:var(--color-success); font-weight:700;">PROCESADA</span>'}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;

      // Vincular botones de creación directa
      document.querySelectorAll('.create-from-req-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const reqId = btn.getAttribute('data-id');
          const req = this.State.locationRequests.find(r => r.id === reqId);
          if (!req) return;

          if (confirm(`¿Deseas crear oficialmente la sucursal "${req.locName}" para ${req.businessName}?`)) {
            if (supabaseClient) {
              // 1. Crear la sucursal real
              const { error: locErr } = await supabaseClient.from('locations').insert([{
                tenant_id: req.tenantId,
                name: req.locName,
                address: req.locAddress,
                maps_url: 'https://maps.google.com', // Placeholder para ser editado
                status: 'active'
              }]);

              if (locErr) {
                alert("Error al crear sucursal: " + locErr.message);
                return;
              }

              // 2. Marcar solicitud como completada
              await supabaseClient.from('location_requests').update({ status: 'completed' }).eq('id', reqId);

              this.addLog('SYSTEM', `ADMIN: Sucursal "${req.locName}" creada exitosamente desde solicitud.`);
              alert("¡Sucursal creada y solicitud marcada como completada!");
              await this.syncFromSupabase();
              this.renderSuperAdminTabContent('requests');
            }
          }
        });
      });
    } else if (tab === 'terminal') {
      this.addLog('GET', `Súper Admin: Cargando consola segura de API Proxy`);
      tabContent.innerHTML = `
        <div class="terminal-window">
          <div class="terminal-header">
            <div class="terminal-dots">
              <span class="terminal-dot red"></span>
              <span class="terminal-dot yellow"></span>
              <span class="terminal-dot green"></span>
            </div>
            <div class="terminal-title" data-i18n="admin_console_title">Terminal del Servidor Node.js - Logs de Proxy n8n</div>
            <button class="btn btn-secondary" id="clear-console-btn" style="padding: 2px 8px; font-size: 0.68rem; width: auto; border-radius: 4px; height: auto;">
              <i data-lucide="trash-2" style="width: 10px; height: 10px;"></i> <span data-i18n="admin_console_clear">Limpiar</span>
            </button>
          </div>
          <div class="terminal-body" id="terminal-body">
            ${this.State.proxyLogs.map(log => {
              const lineClass = log.type === 'POST' ? 'method-post' : log.type === 'GET' ? 'method-get' : log.type === 'SYSTEM' ? 'system' : 'success';
              return `<div class="terminal-line ${lineClass}">[${log.timestamp}] [${log.type}] ${log.message}</div>`;
            }).join('')}
          </div>
        </div>
        <p style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 8px; text-align: right;" data-i18n="admin_console_status">Estado del Servidor: Activo (Puerto 5000)</p>
      `;

      const termBody = document.getElementById('terminal-body');
      if (termBody) termBody.scrollTop = termBody.scrollHeight;

      document.getElementById('clear-console-btn').addEventListener('click', () => {
        this.State.proxyLogs = [];
        this.addLog('SYSTEM', 'Terminal limpiada por el super administrador.');
        this.renderSuperAdminTabContent('terminal');
      });
    } else if (tab === 'plans') {
      this.addLog('GET', `Súper Admin: Gestión de configuración de Planes y Pasarela Wompi`);
      tabContent.innerHTML = `
        <!-- Configuración de Wompi -->
        <div class="card" style="border-top: 4px solid #ED1C24; margin-bottom: 24px;">
          <h3 class="card-title"><i data-lucide="shield-check"></i> Configuración de Pasarela Wompi</h3>
          <div class="form-row" style="margin-top: 16px;">
            <div class="form-group">
              <label class="form-label">Llave Pública (Public Key)</label>
              <input type="text" class="form-control" id="wompi-pub-key" value="${this.State.wompiConfig.publicKey}" placeholder="pub_test_...">
            </div>
            <div class="form-group">
              <label class="form-label">Llave Privada (Private Key)</label>
              <input type="password" class="form-control" id="wompi-priv-key" value="${this.State.wompiConfig.privateKey}" placeholder="prv_test_...">
            </div>
            <div class="form-group">
              <label class="form-label">Secreto de Integridad</label>
              <input type="password" class="form-control" id="wompi-integrity-secret" value="${this.State.wompiConfig.integritySecret}" placeholder="test_integrity_...">
            </div>
          </div>
          <div style="display: flex; gap: 12px; margin-top: 12px; flex-wrap: wrap;">
            <button class="btn btn-primary" id="save-wompi-keys" style="width: auto; padding: 10px 20px;">
              <i data-lucide="save"></i> Guardar Llaves de API
            </button>
            <div style="flex: 1; min-width: 250px; padding: 10px; background: rgba(0, 123, 255, 0.05); border-radius: 8px; border: 1px solid rgba(0, 123, 255, 0.1); display: flex; align-items: center; gap: 10px;">
              <i data-lucide="info" style="width: 20px; height: 20px; color: var(--color-brand); flex-shrink: 0;"></i>
              <div style="font-size: 0.75rem; color: var(--text-secondary);">
                <strong>URL de Respuesta Wompi:</strong><br>
                <code style="word-break: break-all;">${window.location.origin}${window.location.pathname}#billing-response</code>
              </div>
            </div>
          </div>
        </div>

        <div class="leads-table-container">
          <table class="leads-table">
            <thead>
              <tr>
                <th>Plan</th>
                <th>Precio (COP)</th>
                <th>Límite de Sedes</th>
                <th>Características</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              ${Object.entries(this.plansConfig).map(([key, plan]) => `
                <tr>
                  <td><strong>${plan.name}</strong></td>
                  <td><input type="number" class="form-control plan-price-input" data-plan="${key}" value="${plan.price}" style="width: 80px; padding: 4px;"></td>
                  <td><input type="text" class="form-control plan-limit-input" data-plan="${key}" value="${plan.limit === Infinity ? 'Ilimitado' : plan.limit}" style="width: 100px; padding: 4px;"></td>
                  <td style="font-size: 0.75rem;">${plan.features.join(', ')}</td>
                  <td>
                    <button class="btn btn-primary save-plan-btn" data-plan="${key}" style="padding: 6px 12px; font-size: 0.75rem; width: auto;">
                      <i data-lucide="save"></i> Guardar
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;

      document.getElementById('save-wompi-keys').addEventListener('click', async () => {
        const pub = document.getElementById('wompi-pub-key').value.trim();
        const priv = document.getElementById('wompi-priv-key').value.trim();
        const integ = document.getElementById('wompi-integrity-secret').value.trim();

        const configData = { publicKey: pub, privateKey: priv, integritySecret: integ };

        // Guardar localmente
        this.State.wompiConfig = { ...this.State.wompiConfig, ...configData };
        Storage.setItem('wompi_public_key', pub);
        Storage.setItem('wompi_private_key', priv);
        Storage.setItem('wompi_integrity_secret', integ);

        // Guardar en la Nube (Sincronización dispositivos)
        if (supabaseClient) {
          const { error } = await supabaseClient
            .from('global_config')
            .upsert({ id: 'wompi', data: configData, updated_at: new Date().toISOString() });
          
          if (error) {
            console.error("Error sincronizando Wompi:", error);
            alert("Llaves guardadas localmente, pero no se pudo sincronizar con la nube.");
          } else {
            alert('Configuración sincronizada exitosamente en todos tus dispositivos.');
          }
        } else {
          alert('Configuración guardada localmente.');
        }

        this.addLog('SYSTEM', `ADMIN: Llaves de Wompi actualizadas.`);
      });

      document.querySelectorAll('.save-plan-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const planKey = btn.getAttribute('data-plan');
          const priceInput = document.querySelector(`.plan-price-input[data-plan="${planKey}"]`);
          const limitInput = document.querySelector(`.plan-limit-input[data-plan="${planKey}"]`);
          
          const price = parseFloat(priceInput.value);
          const limitVal = limitInput.value;
          const limit = limitVal.toLowerCase() === 'ilimitado' || limitVal === 'Infinity' ? null : parseInt(limitVal);

          if (supabaseClient) {
            this.addLog('POST', `ADMIN: Actualizando plan "${planKey}" en Supabase...`);
            const { error } = await supabaseClient
              .from('plans')
              .update({ price: price, location_limit: limit })
              .eq('id', planKey);

            if (error) {
              alert("Error al actualizar plan en Supabase: " + error.message);
              return;
            }
          }

          // Actualizar estado local
          this.plansConfig[planKey].price = price;
          this.plansConfig[planKey].limit = limit === null ? Infinity : limit;
          this.PlanLimits[planKey] = this.plansConfig[planKey].limit;
          
          this.addLog('SYSTEM', `ADMIN: Plan "${planKey}" actualizado. Nuevo precio: $${price}, Límite: ${limitVal}`);
          alert(`Plan ${planKey.toUpperCase()} actualizado correctamente.`);
        });
      });
    } else if (tab === 'tenants') {
      this.addLog('GET', `Súper Admin: Auditando base de datos de Tenants registrados`);
      
      if (!this.State.users || this.State.users.length === 0) {
        tabContent.innerHTML = `
          <div style="text-align:center; padding: 40px; color: var(--text-secondary);">
            <i data-lucide="users" style="width: 48px; height: 48px; margin-bottom: 16px; opacity: 0.3;"></i>
            <p>No se encontraron cuentas de comercio registradas.</p>
            <p style="font-size: 0.75rem; margin-top: 8px;">Si tienes datos en Supabase, verifica las políticas de RLS.</p>
            <button class="btn btn-secondary" onclick="App.syncFromSupabase()" style="margin-top: 16px;">
              <i data-lucide="refresh-cw"></i> Reintentar Sincronización
            </button>
          </div>
        `;
        lucide.createIcons();
        return;
      }

      tabContent.innerHTML = `
        <div class="leads-table-container">
          <table class="leads-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Comercio</th>
                <th>Contacto</th>
                <th>Estado Suscripción</th>
                <th>Finanzas</th>
                <th>Sedes</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${this.State.users
                .filter(u => u.email !== 'admin@impulsa.com')
                .map(u => {
                  const count = (this.State.locations || []).filter(loc => loc.userId === u.id).length;

                const expiryDate = u.subscriptionExpiry ? new Date(u.subscriptionExpiry) : null;
                const isExpired = expiryDate && expiryDate < new Date();
                const statusColor = isExpired ? 'var(--color-danger)' : 'var(--color-success)';
                const planDisplay = (u.plan || 'free').toUpperCase();
                
                return `
                  <tr>
                    <td><strong>${u.id ? u.id.substring(0, 8) : '???'}...</strong></td>
                    <td style="display: flex; align-items: center; gap: 10px;">
                      <div style="width: 32px; height: 32px; border-radius: 50%; overflow: hidden; border: 1px solid var(--border-color); display: flex; align-items: center; justify-content: center; background: white;">
                        ${u.logo && u.logo.startsWith('http') ? `<img src="${u.logo}" style="width:100%; height:100%; object-fit:cover;">` : u.logo || '🏪'}
                      </div>
                      <div style="display: flex; flex-direction: column;">
                        <strong>${u.businessName || 'Sin Nombre'}</strong>
                        <span style="font-size: 0.75rem; color: var(--text-secondary);">${u.email || 'Sin Email'}</span>
                      </div>
                    </td>
                    <td>
                      <div style="display: flex; flex-direction: column;">
                        <span>${u.fullName || 'No registrado'}</span>
                        ${u.whatsapp ? `
                          <a href="https://wa.me/${u.whatsapp}" target="_blank" style="color: var(--color-success); font-size: 0.75rem; text-decoration: none;">
                            <i data-lucide="message-circle" style="width: 12px; height: 12px; display: inline; vertical-align: middle;"></i> ${u.whatsapp}
                          </a>
                        ` : '<span style="font-size: 0.75rem; color: var(--text-secondary);">Sin WA</span>'}
                      </div>
                    </td>
                    <td>
                      <div style="display: flex; flex-direction: column; font-size: 0.8rem;">
                        <span style="font-weight: 700; color: ${statusColor};">
                          ${planDisplay} (${u.subscriptionPeriod || 1} Meses)
                        </span>
                        <span style="color: var(--text-secondary); font-size: 0.7rem;">
                          Vence: ${expiryDate ? expiryDate.toLocaleDateString() : 'N/A'}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div style="display: flex; flex-direction: column; text-align: right;">
                        <strong style="color: var(--color-brand);">$${u.lastPaymentAmount || '0.00'}</strong>
                        <span style="font-size: 0.7rem; color: var(--text-secondary);">Pagado: ${u.subscriptionDate ? new Date(u.subscriptionDate).toLocaleDateString() : 'N/A'}</span>
                      </div>
                    </td>
                    <td style="text-align: center;"><strong>${count}</strong></td>
                    <td>
                      <button class="btn btn-secondary btn-sm send-message-btn" data-id="${u.id}" data-name="${u.businessName}" style="padding: 4px 8px; font-size: 0.75rem;">
                        <i data-lucide="bell" style="width: 12px; height: 12px;"></i> Notificar
                      </button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;

      // Vincular eventos de envío de mensaje
      document.querySelectorAll('.send-message-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const tenantId = btn.getAttribute('data-id');
          const businessName = btn.getAttribute('data-name');
          this.promptSendMessage(tenantId, businessName);
        });
      });
    }

    this.translateInterface();
  },

  async promptSendMessage(tenantId, businessName) {
    const message = prompt(`Escribe el mensaje que deseas enviar a "${businessName}":\n\n(Ej: Tu plan vence en 3 días, por favor renueva para evitar interrupciones.)`);
    
    if (!message || message.trim() === '') return;

    if (supabaseClient) {
      this.addLog('POST', `ADMIN: Enviando mensaje a ${businessName}...`);
      const { error } = await supabaseClient
        .from('messages')
        .insert({
          tenant_id: tenantId,
          content: message,
          sender: 'Soporte IMPULSA'
        });

      if (error) {
        alert("Error al enviar el mensaje: " + error.message);
        return;
      }

      alert("Mensaje enviado exitosamente.");
      this.addLog('SYSTEM', `ADMIN: Mensaje enviado a "${businessName}": ${message}`);
      
      // Sincronizar para ver el cambio
      await this.syncFromSupabase();
    } else {
      alert("Error: Supabase no está conectado.");
    }
  },

  // ==========================================================================
  // 🤖 VISTA: CENTRO DE AYUDA (SupportPage / ChatWidget)
  // ==========================================================================
  renderSupportPage(container) {
    container.innerHTML = `
      <div style="margin-bottom: 24px;">
        <h2 style="font-size: 1.4rem;" data-i18n="nav_support">Centro de Ayuda e Integración</h2>
        <p style="color: var(--text-secondary); font-size: 0.88rem;" data-i18n="sup_subtitle">Conoce cómo funciona nuestro proxy seguro y envía peticiones simuladas.</p>
      </div>

      <div class="card">
        <h3 class="card-title"><i data-lucide="shield-check"></i> Seguridad de Proxy Seguro</h3>
        <p style="font-size: 0.9rem; line-height: 1.6; color: var(--text-secondary); margin-top: 8px;" data-i18n="sup_proxy_desc">
          El proxy seguro de IMPULSA actúa como una capa intermedia entre tu navegador y los servidores externos de n8n. Esto previene ataques de CORS y protege tus API keys confidenciales del lado del servidor.
        </p>

        <!-- Flujo Visual -->
        <div class="proxy-flow-container">
          <div class="proxy-node">
            <div class="proxy-node-icon"><i data-lucide="smartphone"></i></div>
            <div class="proxy-node-info">
              <h4>Cliente (Dispositivo Móvil)</h4>
              <p>Navegador enviando feedback o chat.</p>
            </div>
          </div>
          <div class="proxy-node" style="border-color: var(--color-brand); background-color: rgba(0,123,255,0.03);">
            <div class="proxy-node-icon" style="background-color: var(--color-brand);"><i data-lucide="server"></i></div>
            <div class="proxy-node-info">
              <h4>IMPULSA Secure Backend Proxy (/api/support)</h4>
              <p>Valida la petición, enmascara credenciales y elude errores de CORS.</p>
            </div>
          </div>
          <div class="proxy-node" style="border-color: var(--color-accent); background-color: rgba(255,165,0,0.03);">
            <div class="proxy-node-icon" style="background-color: var(--color-accent);"><i data-lucide="network"></i></div>
            <div class="proxy-node-info">
              <h4>Webhook Oficial (n8n / CRM / Slack)</h4>
              <p>Servicio externo procesando el webhook de forma ultra segura.</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Formulario para enviar un mensaje de prueba al webhook externo -->
      <div class="card" style="margin-top: 24px;">
        <h3 class="card-title"><i data-lucide="terminal"></i> <span data-i18n="sup_send_test">Enviar Mensaje de Prueba</span></h3>
        <div style="margin-top: 12px; display: flex; flex-direction: column; gap: 12px;">
          <input type="text" class="form-control" id="webhook-test-input" required placeholder="Escribe un mensaje de prueba..." data-i18n-placeholder="sup_test_placeholder">
          <button class="btn btn-primary" id="webhook-test-btn">
            <i data-lucide="zap"></i>
            <span data-i18n="sup_test_send_btn">Probar Proxy /api/support</span>
          </button>
        </div>
      </div>

      <!-- Sección de Contacto Directo y Bot de Soporte (NUEVO) -->
      <div class="card" style="margin-top: 24px; border-top: 4px solid var(--color-success);">
        <h3 class="card-title" data-i18n="land_contact_title">Contacto Directo</h3>
        <p style="font-size: 0.9rem; color: var(--text-secondary); margin-top: 8px;" data-i18n="land_contact_subtitle">¿Tienes dudas adicionales o requieres una implementación personalizada?</p>
        
        <div style="display: flex; gap: 20px; margin-top: 20px; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 200px; display: flex; align-items: center; gap: 12px; padding: 12px; background: var(--bg-primary); border-radius: 8px; border: 1px solid var(--border-color);">
            <i data-lucide="mail" style="color: var(--color-brand);"></i>
            <div>
              <span style="display: block; font-size: 0.75rem; color: var(--text-secondary);" data-i18n="land_contact_email_label">Correo</span>
              <strong style="font-size: 0.9rem;">aiimplementaciones@gmail.com</strong>
            </div>
          </div>
          <div style="flex: 1; min-width: 200px; display: flex; align-items: center; gap: 12px; padding: 12px; background: var(--bg-primary); border-radius: 8px; border: 1px solid var(--border-color);">
            <i data-lucide="message-circle" style="color: var(--color-success);"></i>
            <div>
              <span style="display: block; font-size: 0.75rem; color: var(--text-secondary);" data-i18n="land_contact_phone_label">WhatsApp</span>
              <strong style="font-size: 0.9rem;">+57 301 685 7098</strong>
            </div>
          </div>
        </div>

        <div style="margin-top: 24px; padding: 16px; background: rgba(0, 123, 255, 0.03); border-radius: 8px; border: 1px dashed var(--color-brand);">
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
            <i data-lucide="bot" style="color: var(--color-brand);"></i>
            <strong style="font-size: 0.95rem; color: var(--color-brand);" data-i18n="land_contact_bot_highlight">Asistente IA 24/7</strong>
          </div>
          <p style="font-size: 0.85rem; color: var(--text-secondary); line-height: 1.5;" data-i18n="land_contact_bot_desc">Nuestro bot inteligente puede responder a tus preguntas y resolver inquietudes de manera automática y precisa.</p>
        </div>
      </div>
    `;

    document.getElementById('webhook-test-btn').addEventListener('click', () => {
      const input = document.getElementById('webhook-test-input');
      if (!input.value) return;

      this.addLog('POST', `[Proxy Secure] Petición entrante para el webhook externo.`);
      this.addLog('POST', `[Proxy Secure] Enrutado exitoso a n8n: Payload: "${input.value}" - CORS eludido. Status: 200 OK.`);
      
      alert(this.State.lang === 'es' 
        ? '¡Petición enviada mediante el Proxy seguro exitosamente! Registrado en los logs de la terminal del Super Admin.' 
        : 'Request sent through the secure Proxy successfully! Check the terminal logs in the Super Admin console.');
      
      input.value = '';
    });
  },

  // ==========================================================================
  // 💬 WIDGET FLOTANTE DE SOPORTE E INTERACCIONES (ChatWidget)
  // ==========================================================================
  initChatWidget() {
    const chatBubble = document.getElementById('chat-bubble');
    const chatSheet = document.getElementById('chat-sheet');
    const closeChatBtn = document.getElementById('close-chat-btn');
    const chatSendBtn = document.getElementById('chat-send-btn');
    const chatInput = document.getElementById('chat-input');
    const messagesContainer = document.getElementById('chat-messages-container');

    if (!chatBubble || !chatSheet) return;

    chatBubble.addEventListener('click', () => {
      chatSheet.classList.add('active');
      // NUEVO: Cargar historial de mensajes al abrir
      this.renderChatHistory();
    });

    closeChatBtn.addEventListener('click', () => {
      chatSheet.classList.remove('active');
    });

    const sendMessage = async () => {
      const text = chatInput.value.trim();
      if (!text) return;

      // Permitir acceso a invitados (sin cuenta)
      const user = this.State.currentUser || {
        id: '00000000-0000-0000-0000-000000000000',
        businessName: 'Invitado',
        fullName: 'Usuario Invitado',
        plan: 'free'
      };

      this.addUserChatMessage(text);
      chatInput.value = '';

      // Agregar mensaje localmente para que aparezca en el chat de inmediato (importante para invitados)
      this.State.messages.push({
        id: Date.now(),
        tenantId: user.id,
        content: text,
        sender: user.businessName || 'Invitado',
        date: new Date().toISOString()
      });

      // URL del Webhook de n8n
      const N8N_WEBHOOK_URL = "https://n8n-n8n.bp2swr.easypanel.host/webhook/9dad719b-b85e-4b00-8398-ecd435f61022";

      const payload = {
        tenant_id: user.id,
        business_name: user.businessName,
        full_name: user.fullName,
        plan: user.plan,
        message: text,
        lang: this.State.lang
      };

      try {
        // 1. Guardar mensaje del USUARIO en Supabase (Solo si es un usuario real)
        if (supabaseClient && this.State.currentUser) {
          await supabaseClient.from('messages').insert({
            tenant_id: user.id,
            content: text,
            sender: user.businessName || 'Comercio'
          });
        }

        // 2. Enviar a n8n y ESPERAR respuesta (Síncrono)
        const response = await fetch(N8N_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const botData = await response.json();
        // n8n Agent suele devolver la respuesta en 'output' o 'text'
        const botText = botData.output || botData.text || botData.message || (typeof botData === 'string' ? botData : null);

        if (botText) {
          this.addAgentChatMessage(botText);
          
          // Agregar respuesta localmente
          this.State.messages.push({
            id: Date.now() + 1,
            tenantId: user.id,
            content: botText,
            sender: 'Soporte IMPULSA',
            date: new Date().toISOString()
          });

          // 3. Guardar respuesta del BOT en Supabase para el historial (Solo si es un usuario real)
          if (supabaseClient && this.State.currentUser) {
            await supabaseClient.from('messages').insert({
              tenant_id: user.id,
              content: botText,
              sender: 'Soporte IMPULSA'
            });
          }
        } else {
          throw new Error("Respuesta de IA vacía");
        }

      } catch (err) {
        console.error("Error en el flujo de soporte:", err);
        this.addAgentChatMessage("Lo siento, tuve un problema conectando con mi cerebro de IA. Por favor, intenta de nuevo en un momento.");
      }
    };

    chatSendBtn.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessage();
    });
  },

  addUserChatMessage(text) {
    const messagesContainer = document.getElementById('chat-messages-container');
    if (!messagesContainer) return;

    const msg = document.createElement('div');
    msg.className = 'chat-message user';
    msg.textContent = text;
    messagesContainer.appendChild(msg);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  },

  renderChatHistory() {
    const messagesContainer = document.getElementById('chat-messages-container');
    if (!messagesContainer) return;

    // Limpiar contenedor
    messagesContainer.innerHTML = '';

    // Si no hay mensajes, mostrar bienvenida
    if (!this.State.messages || this.State.messages.length === 0) {
      this.addAgentChatMessage(this.t('sup_chat_agent_welcome'));
      return;
    }

    // Ordenar mensajes por fecha (más antiguos primero para el chat)
    const sortedMsgs = [...this.State.messages].sort((a, b) => new Date(a.date) - new Date(b.date));

    sortedMsgs.forEach(m => {
      // Si el remitente es el nombre del negocio o Invitado, es un mensaje del usuario
      const currentUser = this.State.currentUser;
      const isUser = (currentUser && (m.sender === currentUser.businessName || m.sender === 'Yo' || m.sender === currentUser.fullName)) 
                     || m.sender === 'Invitado' || m.sender === 'Usuario Invitado';
      
      if (isUser) {
        this.addUserChatMessage(m.content);
      } else {
        this.addAgentChatMessage(m.content);
      }
    });
  },

  addAgentChatMessage(text) {
    const messagesContainer = document.getElementById('chat-messages-container');
    if (!messagesContainer) return;

    const msg = document.createElement('div');
    msg.className = 'chat-message agent';
    msg.textContent = text;
    messagesContainer.appendChild(msg);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    lucide.createIcons();
  },

  // ==========================================================================
  // ⚙️ BIND EVENTS: CONFIGURACIONES GLOBALES Y EVENTOS DE CABECERA
  // ==========================================================================
  bindGlobalEvents() {
    // Vincular Cambio de Tema Claro/Oscuro
    const themeBtn = document.getElementById('theme-btn');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        this.State.theme = this.State.theme === 'dark' ? 'light' : 'dark';
        Storage.setItem('impulsa_theme', this.State.theme);
        this.applyTheme();
        this.addLog('SYSTEM', `Tema cambiado a: ${this.State.theme.toUpperCase()}`);
      });
    }

    // Vincular Cambio de Idioma Dinámico
    const langBtn = document.getElementById('lang-btn');
    if (langBtn) {
      langBtn.addEventListener('click', () => {
        this.State.lang = this.State.lang === 'es' ? 'en' : 'es';
        Storage.setItem('impulsa_lang', this.State.lang);
        this.translateInterface();
        this.addLog('SYSTEM', `Idioma global cambiado a: ${this.State.lang.toUpperCase()}`);
        this.renderPageContent(this.State.activePage);
      });
    }

    // Vincular Cierre de modal de Checkout Bancolombia
    const closeCheckoutBtn = document.getElementById('close-checkout-btn');
    if (closeCheckoutBtn) {
      closeCheckoutBtn.addEventListener('click', () => {
        const modal = document.getElementById('checkout-modal');
        if (modal) modal.classList.remove('active');
      });
    }

    // Formateadores dinámicos del Checkout pasarela
    const cardInput = document.getElementById('card-number');
    if (cardInput) {
      cardInput.addEventListener('input', (e) => {
        let val = e.target.value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
        let formatted = '';
        for (let i = 0; i < val.length; i++) {
          if (i > 0 && i % 4 === 0) formatted += ' ';
          formatted += val[i];
        }
        e.target.value = formatted;
      });
    }

    const expiryInput = document.getElementById('card-expiry');
    if (expiryInput) {
      expiryInput.addEventListener('input', (e) => {
        let val = e.target.value.replace(/\D/g, '');
        if (val.length >= 2) {
          e.target.value = val.substring(0, 2) + '/' + val.substring(2, 4);
        } else {
          e.target.value = val;
        }
      });
    }

    const cvcInput = document.getElementById('card-cvc');
    if (cvcInput) {
      cvcInput.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '');
      });
    }

    this.initChatWidget();
  },

  applyTheme() {
    document.documentElement.setAttribute('data-theme', this.State.theme);
    const sunIcon = document.querySelector('.theme-icon-sun');
    const moonIcon = document.querySelector('.theme-icon-moon');
    
    if (sunIcon && moonIcon) {
      if (this.State.theme === 'dark') {
        sunIcon.style.display = 'none';
        moonIcon.style.display = 'block';
      } else {
        sunIcon.style.display = 'block';
        moonIcon.style.display = 'none';
      }
    }
  },

  translateInterface() {
    const elements = document.querySelectorAll('[data-i18n]');
    elements.forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (translations[this.State.lang] && translations[this.State.lang][key]) {
        el.textContent = translations[this.State.lang][key];
      }
    });

    const placeholders = document.querySelectorAll('[data-i18n-placeholder]');
    placeholders.forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (translations[this.State.lang] && translations[this.State.lang][key]) {
        el.setAttribute('placeholder', translations[this.State.lang][key]);
      }
    });

    lucide.createIcons();
  },

  t(key, replaces = {}) {
    let text = translations[this.State.lang][key] || key;
    Object.keys(replaces).forEach(k => {
      text = text.replace(`{${k}}`, replaces[k]);
    });
    return text;
  },

  // ==========================================================================
  // 📈 MÓDULO DE MERCADEO Y PROSPECTOS (SUPER ADMIN)
  // ==========================================================================
  async loadMarketingProspects() {
    if (!supabaseClient) return;
    const body = document.getElementById('prospects-body');
    if (!body) return;

    const { data, error } = await supabaseClient
      .from('marketing_prospects')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      body.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--color-danger);">Error: ${error.message}</td></tr>`;
      return;
    }

    if (data.length === 0) {
      body.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px;">No hay prospectos registrados aún.</td></tr>`;
      return;
    }

    body.innerHTML = data.map(p => `
      <tr>
        <td>
          <div style="display:flex; align-items:center; gap:8px;">
            <div style="width:32px; height:32px; border:1px solid #ddd; border-radius:5px; display:flex; align-items:center; justify-content:center; background:white; overflow:hidden;">
              ${p.logo.startsWith('http') ? `<img src="${p.logo}" style="width:100%; height:100%; object-fit:cover;">` : p.logo}
            </div>
            <strong>${p.business_name}</strong>
          </div>
        </td>
        <td>
          <div style="font-size:0.85rem;">
            <strong>${p.loc_name}</strong><br>
            <span style="color:var(--text-secondary);">${p.loc_address || 'Sin dirección'}</span>
          </div>
        </td>
        <td>
          <div style="font-size:0.8rem;">
            ${p.contact_name || 'N/A'}<br>
            <a href="https://wa.me/${p.contact_whatsapp}" target="_blank" style="color:var(--color-success); font-weight:600;">
              <i data-lucide="message-circle" style="width:12px; height:12px;"></i> ${p.contact_whatsapp || ''}
            </a>
          </div>
        </td>
        <td>
          <span class="status-badge ${p.status === 'converted' ? 'active' : 'inactive'}">${p.status.toUpperCase()}</span>
        </td>
        <td>
          <div style="display:flex; gap:5px;">
            <button class="btn btn-secondary share-prospect-btn" data-id="${p.id}" data-name="${p.business_name}" title="Compartir Demo" style="padding:6px; width:auto;">
              <i data-lucide="share-2"></i>
            </button>
            <button class="btn btn-secondary edit-prospect-btn" data-id="${p.id}" title="Editar Prospecto" style="padding:6px; width:auto;">
              <i data-lucide="edit"></i>
            </button>
            ${p.status !== 'converted' ? `
              <button class="btn btn-primary transfer-prospect-btn" data-id="${p.id}" title="Transferir a Cliente Real" style="padding:6px 12px; font-size:0.75rem; width:auto;">
                <i data-lucide="user-plus"></i> Transferir
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `).join('');

    lucide.createIcons();

    // Vincular acciones
    document.querySelectorAll('.share-prospect-btn').forEach(btn => {
      btn.addEventListener('click', () => this.shareProspectPortal(btn.getAttribute('data-id'), btn.getAttribute('data-name')));
    });

    document.querySelectorAll('.edit-prospect-btn').forEach(btn => {
      btn.addEventListener('click', () => this.handleEditProspect(btn.getAttribute('data-id')));
    });

    document.querySelectorAll('.transfer-prospect-btn').forEach(btn => {
      btn.addEventListener('click', () => this.transferProspectToClient(btn.getAttribute('data-id')));
    });
  },

  async handleMarketingCSV() {
    console.log("Iniciando procesamiento de CSV...");
    const fileInput = document.getElementById('marketing-csv-upload');
    if (!fileInput.files.length) {
      alert("Por favor selecciona un archivo CSV.");
      return;
    }

    const file = fileInput.files[0];
    console.log("Archivo seleccionado:", file.name, file.size, "bytes");
    const reader = new FileReader();

    reader.onload = async (e) => {
      console.log("Archivo leído con éxito.");
      const text = e.target.result;
      const lines = text.split('\n');
      console.log("Total líneas detectadas:", lines.length);
      const prospects = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        // Detectar delimitador (Soportar coma o punto y coma)
        const delimiter = line.includes(';') ? ';' : ',';
        const parts = line.split(delimiter);
        
        console.log(`Procesando línea ${i} (Delimitador: ${delimiter}):`, parts);
        const [business_name, logo, accent_color, contact_name, contact_whatsapp, loc_name, loc_address, loc_maps_url] = parts.map(s => s ? s.trim() : '');
        
        if (business_name && loc_name && business_name !== 'NombreNegocio') {
          prospects.push({
            business_name,
            logo: logo || '🏪',
            accent_color: accent_color || '#6366f1',
            contact_name: contact_name || '',
            contact_whatsapp: contact_whatsapp || '',
            loc_name,
            loc_address: loc_address || '',
            loc_maps_url: loc_maps_url || 'https://maps.google.com'
          });
        }
      }

      console.log("Prospectos válidos encontrados:", prospects.length);

      if (prospects.length > 0 && supabaseClient) {
        this.addLog('POST', `Súper Admin: Subiendo ${prospects.length} prospectos desde CSV.`);
        const { error } = await supabaseClient.from('marketing_prospects').insert(prospects);
        
        if (error) {
          console.error("Error en Supabase:", error);
          alert("Error al cargar prospectos: " + error.message);
        } else {
          console.log("Subida exitosa a Supabase.");
          alert(`¡Éxito! Se cargaron ${prospects.length} prospectos.`);
          this.loadMarketingProspects();
          fileInput.value = '';
        }
      } else if (prospects.length === 0) {
        alert("No se encontraron datos válidos en el CSV. Asegúrate de seguir el formato: NombreNegocio, LogoUrl/Emoji, ColorHex, NombreContacto, WhatsApp, NombreSucursal, Direccion, MapsUrl");
      }
    };

    reader.onerror = (err) => {
      console.error("Error al leer el archivo:", err);
      alert("Error al leer el archivo.");
    };

    reader.readAsText(file);
  },

  async shareProspectPortal(id, name) {
    const portalUrl = `${window.location.origin}/#portal?prospect=${id}`;
    const message = `¡Hola! Hemos pre-construido una demo del portal de calificaciones para ${name}. Míralo aquí: ${portalUrl}`;
    
    if (navigator.share) {
      navigator.share({
        title: `Portal Demo para ${name}`,
        text: message,
        url: portalUrl
      }).catch(err => console.log('Error compartiendo:', err));
    } else {
      navigator.clipboard.writeText(portalUrl);
      alert('Enlace de demo copiado al portapapeles.');
    }
  },

  async handleEditProspect(id) {
    if (!supabaseClient) return;

    // 1. Obtener datos actuales del prospecto
    const { data: p, error } = await supabaseClient.from('marketing_prospects').select('*').eq('id', id).single();
    if (error || !p) {
      alert("Error al cargar datos del prospecto");
      return;
    }

    // 2. Pedir nuevos datos (Simple prompt para agilidad)
    const newName = prompt("Nombre del Negocio:", p.business_name);
    if (newName === null) return;

    const newLogo = prompt("Logo (Emoji o URL):", p.logo);
    if (newLogo === null) return;

    const newColor = prompt("Color de Marca (Hex):", p.accent_color);
    if (newColor === null) return;

    const newContactName = prompt("Nombre del Contacto:", p.contact_name);
    if (newContactName === null) return;

    const newWhatsApp = prompt("WhatsApp (solo números):", p.contact_whatsapp);
    if (newWhatsApp === null) return;

    const newLocName = prompt("Nombre de la Sucursal:", p.loc_name);
    if (newLocName === null) return;

    const newLocAddr = prompt("Dirección de la Sucursal:", p.loc_address);
    if (newLocAddr === null) return;

    const newMaps = prompt("Enlace Google Maps:", p.loc_maps_url);
    if (newMaps === null) return;

    // 3. Actualizar en Supabase
    this.addLog('PUT', `Súper Admin: Editando prospecto "${p.business_name}"`);
    const { error: updError } = await supabaseClient.from('marketing_prospects').update({
      business_name: newName,
      logo: newLogo,
      accent_color: newColor,
      contact_name: newContactName,
      contact_whatsapp: newWhatsApp,
      loc_name: newLocName,
      loc_address: newLocAddr,
      loc_maps_url: newMaps
    }).eq('id', id);

    if (updError) {
      alert("Error al actualizar: " + updError.message);
    } else {
      alert("Prospecto actualizado con éxito");
      this.loadMarketingProspects();
    }
  },

  async transferProspectToClient(prospectId) {
    if (!supabaseClient) return;

    const email = prompt("Introduce el correo electrónico del cliente REAL para transferir este portal:");
    if (!email) return;

    // 1. Buscar el perfil por email
    const { data: profile, error: profError } = await supabaseClient
      .from('profiles')
      .select('id, business_name')
      .eq('email', email)
      .single();

    if (profError || !profile) {
      alert("No se encontró ningún comercio registrado con ese correo electrónico. El cliente debe registrarse primero.");
      return;
    }

    if (confirm(`¿Transferir la sucursal pre-construida a "${profile.business_name}"?`)) {
      const { data: prospect, error: prError } = await supabaseClient
        .from('marketing_prospects')
        .select('*')
        .eq('id', prospectId)
        .single();

      if (prError) return;

      // 2. Crear la sucursal real
      const { error: locError } = await supabaseClient.from('locations').insert([{
        tenant_id: profile.id,
        name: prospect.loc_name,
        address: prospect.loc_address,
        maps_url: prospect.loc_maps_url,
        logo: prospect.logo,
        status: 'active'
      }]);

      if (locError) {
        alert("Error al transferir: " + locError.message);
        return;
      }

      // 3. Actualizar perfil si es necesario (Opcional: logo y color)
      await supabaseClient.from('profiles').update({
        logo: prospect.logo,
        accent_color: prospect.accent_color
      }).eq('id', profile.id);

      // 4. Marcar prospecto como convertido
      await supabaseClient.from('marketing_prospects').update({ 
        status: 'converted',
        converted_tenant_id: profile.id
      }).eq('id', prospectId);

      this.addLog('SYSTEM', `ADMIN: Portal de "${prospect.business_name}" transferido a cuenta real de ${email}`);
      alert("¡Transferencia completada con éxito!");
      this.loadMarketingProspects();
    }
  }
};

// Arrancar la aplicación
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
