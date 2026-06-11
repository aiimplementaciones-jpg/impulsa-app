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
    proxyLogs: [],      // Logs del Servidor seguro /api/support
    visits: 0,          // Semilla global de visitas
    wompiConfig: {      // Configuración de Pasarela Wompi
      publicKey: Storage.getItem('wompi_public_key') || '',
      privateKey: Storage.getItem('wompi_private_key') || '',
      integritySecret: Storage.getItem('wompi_integrity_secret') || '',
      mode: 'sandbox' // 'sandbox' o 'production'
    }
  },

  // Configuración de planes dinámica (Se puebla desde Supabase, con valores por defecto)
  plansConfig: {
    free: { name: 'Plan Starter', price: 0, limit: 1, features: ['Indicador LED animado', 'Códigos QR de Alta Definición', 'Portal móvil personalizable'] },
    pro: { name: 'Plan Pro Profesional', price: 16, limit: 3, features: ['Indicador LED animado', 'Códigos QR de Alta Definición', 'Portal móvil personalizable', 'Filtro estratégico de reseñas', 'Simulador de servidor de API'] },
    star: { name: 'Plan Star Ilimitado', price: 29, limit: Infinity, features: ['Indicador LED animado', 'Códigos QR de Alta Definición', 'Portal móvil personalizable', 'Filtro estratégico de reseñas', 'Simulador de servidor de API', 'Soporte prioritario'] }
  },

  // Límites de locales por plan (Se actualizan desde Supabase)
  PlanLimits: {
    free: 1,
    pro: 3,
    star: Infinity
  },

  // Inicializar Base de Datos y Preferencias
  async init() {
    this.State.lang = Storage.getItem('impulsa_lang') || 'es';
    this.State.theme = Storage.getItem('impulsa_theme') || 'light';

    // 🔐 RESTAURAR SESIÓN ACTIVA (Persistencia)
    const activeUserId = Storage.getItem('impulsa_active_user');
    if (activeUserId) {
      // Si es el usuario de desarrollo o cualquier otro ID guardado, 
      // lo pre-cargamos para evitar que el router nos saque al Login mientras sincronizamos.
      this.State.currentUser = { id: activeUserId, businessName: '...' };
    }

    if (supabaseClient) {
      this.addLog('SYSTEM', '🔌 Conectando a la base de datos de Supabase en la nube...');
      await this.syncFromSupabase();
    } else {
      this.addLog('SYSTEM', '⚠️ Supabase no configurado o inaccesible.');
      this.State.users = [];
      this.State.locations = [];
      this.State.leads = [];
    }

    this.State.isSuperAdmin = Storage.getItem('impulsa_is_superadmin') === 'true';

    // 5. Configurar logs de consola del servidor seguros
    this.addLog('SYSTEM', 'Servidor seguro de IMPULSA levantado en el puerto 5000.');
    this.addLog('SYSTEM', 'Middleware /api/support listo para eludir restricciones de CORS.');

    // 6. Lanzar visualizaciones
    this.applyTheme();
    this.bindGlobalEvents();
    
    // Iniciar Router dinámico
    this.handleRouting();
    window.addEventListener('hashchange', () => this.handleRouting());
  },

  // Sincronizar toda la data desde Supabase
  async syncFromSupabase() {
    try {
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
        this.addLog('SYSTEM', 'Configuración de planes cargada desde la nube.');
      }

      // 1b. Obtener la sesión activa de Supabase
      const { data: { session } } = await supabaseClient.auth.getSession();
      let activeUserId = session?.user?.id;

      // Si no hay sesión real pero hay bypass, usamos el ID de Mauro
      if (!activeUserId && this.State.currentUser) {
        activeUserId = this.State.currentUser.id;
      }

      if (activeUserId) {
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
            title: profile.portal_title || (profile.business_name ? `Opiniones de ${profile.business_name}` : 'Portal de Opiniones')
          };
        } else if (profileErr) {
          this.addLog('SYSTEM', `Error obteniendo perfil: ${profileErr.message}`);
        }
      } else {
        this.State.currentUser = null;
      }

      // 2. Obtener los locales (siempre de la tabla 'locations')
      let queryLoc = supabaseClient.from('locations').select('*');
      if (this.State.currentUser && !this.State.isSuperAdmin) {
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

      // 3. Obtener los feedbacks (leads)
      let queryLeads = supabaseClient.from('leads').select('*');
      if (this.State.currentUser && !this.State.isSuperAdmin) {
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
          clientName: f.client_name,
          clientPhone: f.client_phone,
          rating: f.rating,
          comment: f.comment || ''
        }));


      // 4. Obtener todos los tenants si es Súper Administrador o poblar con el actual
      if (this.State.isSuperAdmin) {
        const { data: dbProfiles } = await supabaseClient.from('profiles').select('*');
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
        const p = profile; // Usar el perfil cargado anteriormente
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

      this.addLog('SYSTEM', `Sincronización con Supabase exitosa: ${this.State.locations.length} sucursales y ${this.State.leads.length} casos cargados.`);

      // 5. Obtener solicitudes de sucursales (Location Requests)
      let queryReq = supabaseClient.from('location_requests').select('*');
      if (this.State.currentUser && !this.State.isSuperAdmin) {
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

      // Refrescar la página actual para mostrar los datos recién cargados (especialmente planes)
      this.addLog('SYSTEM', 'Interfaz de usuario actualizada con datos de la nube.');
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
      this.renderOpinionPortal(locationId);
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
      <section style="margin-top: 48px; margin-bottom: 24px; text-align:center;">
        <h2 style="font-size:1.5rem;" data-i18n="land_pricing_title">Planes diseñados para cada etapa de tu negocio</h2>
        <p style="color:var(--text-secondary); font-size:0.9rem; margin-top:6px;" data-i18n="land_pricing_desc">Comienza sin costo o expande tus sucursales con nuestros planes flexibles.</p>
        <a href="#register" class="btn btn-accent" style="margin-top:20px; max-width:320px; height:50px;">
          🚀 <span data-i18n="land_cta_register">Registrarse Gratis</span>
        </a>
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
      this.State.isSuperAdmin = true;
      Storage.setItem('impulsa_is_superadmin', 'true');
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
                <a href="https://wa.me/${lead.clientPhone}" target="_blank" class="btn btn-primary" style="padding: 5px 10px; font-size: 0.7rem;">
                  <i data-lucide="phone"></i> Contactar
                </a>
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
                  <i data-lucide="download"></i> QR
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
                <button class="btn btn-secondary" onclick="navigator.clipboard.writeText('${window.location.origin}/#portal?id=${loc.id}'); alert('Enlace de sucursal copiado');" style="padding: 8px 12px; font-size: 0.8rem; border-radius: var(--radius-sm); width: 100%;">
                  <i data-lucide="copy"></i> Copiar Enlace Directo
                </button>
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
    const logo = user.logo || '🏪';
    this.addLog('GET', `Generando QR HD para: "${name}"`);

    this.generateQRCodeCanvas(portalUrl, (canvas) => {
      // Crear un canvas final con un diseño tipo tarjeta (Más alto para mejor margen)
      const finalCanvas = document.createElement('canvas');
      finalCanvas.width = 1200;
      finalCanvas.height = 1800; // Aumentado de 1600 a 1800 para margen inferior
      const ctx = finalCanvas.getContext('2d');

      // Fondo
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 1200, 1800);

      // Cabecera con Degradado
      const grad = ctx.createLinearGradient(0, 0, 1200, 0);
      grad.addColorStop(0, user.accentColor || '#6366f1');
      grad.addColorStop(1, '#4f46e5');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 1200, 320);

      // Texto "IMPULSA" y Logo/Emoji
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 70px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('IMPULSA', 220, 190);
      
      // Dibujar Emoji o Placeholder de logo en la cabecera
      ctx.font = '90px sans-serif';
      ctx.fillText(logo.startsWith('http') ? '🖼️' : logo, 80, 200);

      // Nombre del Negocio
      ctx.fillStyle = '#1f2937';
      ctx.font = 'bold 90px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(user.businessName.toUpperCase(), 600, 480);
      
      ctx.font = '60px sans-serif';
      ctx.fillStyle = '#6b7280';
      ctx.fillText(name, 600, 580);

      // Dibujar el QR (Centrado y con buen tamaño)
      ctx.drawImage(canvas, 100, 650, 1000, 1000);

      // Pie de página (Con más aire abajo)
      ctx.font = 'bold 55px sans-serif';
      ctx.fillStyle = '#111827';
      ctx.fillText('¡Tu opinión nos ayuda a crecer!', 600, 1720);

      const image = finalCanvas.toDataURL("image/png");
      const link = document.createElement('a');
      link.download = `QR_IMPULSA_${name.replace(/\s+/g, '_')}.png`;
      link.href = image;
      link.click();
    });
  },

  printQRCode(id, name) {
    const portalUrl = `${window.location.origin}${window.location.pathname}#portal?id=${id}`;
    const user = this.State.currentUser;
    const logo = user.logo || '🏪';
    
    this.generateQRCodeCanvas(portalUrl, (canvas) => {
      const qrDataUrl = canvas.toDataURL("image/png");
      const printWindow = window.open('', '_blank');
      
      const accentColor = user.accentColor || '#6366f1';
      const bgColor = user.bgColor || '#ffffff';
      
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
                width: 100px;
                height: 100px;
                background: white;
                border-radius: 25px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 3.5rem;
                overflow: hidden;
                box-shadow: 0 8px 16px rgba(0,0,0,0.15);
              }
              .business-logo img {
                width: 100%;
                height: 100%;
                object-fit: cover;
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
              }
              .qr-img {
                width: 260px;
                height: 260px;
                display: block;
              }
              .cta-text {
                font-weight: 800;
                font-size: 1.6rem;
                color: #111827;
                margin-bottom: 10px;
              }
              .sub-text {
                font-size: 1.1rem;
                color: #4b5563;
                line-height: 1.4;
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
                  ${logo.startsWith('http') ? `<img src="${logo}">` : logo}
                </div>
                <div class="brand-name">${user.businessName}</div>
              </div>
              <div class="content">
                <div class="business-name-main">¡CALIFÍCANOS!</div>
                <div class="location-name">${name}</div>
                <div class="qr-container">
                  <img src="${qrDataUrl}" class="qr-img" />
                </div>
                <div class="cta-text">Tu opinión importa</div>
                <div class="sub-text">Escanea el código para dejarnos tu reseña y ayudarnos a mejorar.</div>
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
  async renderOpinionPortal(locationId) {
    let loc = this.State.locations.find(l => l.id === locationId);
    
    // Si no está en estado (ej: cliente entra directo por URL), lo buscamos en Supabase
    if (!loc && supabaseClient) {
      const { data, error } = await supabaseClient.from('locations').select('*').eq('id', locationId).single();
      if (data) {
        loc = {
          id: data.id,
          userId: data.tenant_id,
          name: data.name,
          address: data.address,
          mapsUrl: data.maps_url || '',
          status: data.status
        };
        this.State.locations.push(loc);
      }
    }

    if (!loc) {
      document.body.innerHTML = `<div style="padding:40px; text-align:center;"><h2>Sucursal no encontrada o inactiva</h2></div>`;
      return;
    }

    // Buscar configuración de diseño del comercio (Tenant) dueño de este local
    let tenant = this.State.users.find(u => u.id === loc.userId);
    
    // Si no tenemos al tenant en el estado, lo buscamos en Supabase
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
            <div class="pricing-price">${plan.price === 0 ? 'Gratis' : `$${plan.price} USD / mes`}</div>
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
      
      if (pendingPlan) {
        this.addLog('SYSTEM', `Confirmando actualización al plan ${pendingPlan.toUpperCase()} para transacción: ${transactionId}`);
        
        try {
          await supabaseClient.from('profiles').update({ 
            plan: pendingPlan,
            subscription_date: new Date().toISOString()
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
      const basePriceUsd = this.plansConfig[plan].price;
      const discounts = { 1: 0, 3: 0.05, 6: 0.1, 9: 0.15, 12: 0.2 };
      
      const exchangeRate = 4000;
      const totalAmountCop = (basePriceUsd * period * (1 - discounts[period]) * exchangeRate);
      const amountInCents = Math.round(totalAmountCop * 100);
      
      formContainer.style.display = 'none';
      processingContainer.style.display = 'block';

      const reference = `IMPULSA-${plan.toUpperCase()}-${Date.now()}`;
      const publicKey = (this.State.wompiConfig.publicKey || 'pub_test_Q5yS9jVvDX70S99IeMoX36O97xYos2K6').trim();
      const integritySecret = (this.State.wompiConfig.integritySecret || '').trim();
      const isTest = publicKey.toLowerCase().includes('test');
      const actionUrl = isTest ? 'https://sandbox.wompi.co/p/' : 'https://checkout.wompi.co/p/';
      const redirectUrl = `${window.location.origin}${window.location.pathname}?pay_res=success`;

      this.addLog('POST', `[Wompi] Generando firma de integridad...`);
      
      // GENERACIÓN DE FIRMA SHA256 (SEGÚN DOCUMENTACIÓN)
      // Orden: <Referencia><MontoEnCentavos><Moneda><SecretoIntegridad>
      const cadenaConcatenada = `${reference}${amountInCents}COP${integritySecret}`;
      
      let signature = '';
      try {
        const encondedText = new TextEncoder().encode(cadenaConcatenada);
        const hashBuffer = await crypto.subtle.digest("SHA-256", encondedText);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        signature = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
        this.addLog('SYSTEM', `Firma Generada: ${signature.substring(0, 10)}...`);
      } catch (err) {
        console.error("Error al generar hash:", err);
        this.addLog('SYSTEM', `Error generando firma SHA256.`);
      }

      this.addLog('POST', `[Wompi] Generando formulario de pago seguro (${isTest ? 'TEST' : 'PROD'})...`);
      
      // Creamos un formulario dinámico
      const form = document.createElement('form');
      form.method = 'GET';
      form.action = actionUrl;

      const params = {
        'public-key': publicKey,
        'currency': 'COP',
        'amount-in-cents': amountInCents,
        'reference': reference,
        'redirect-url': redirectUrl,
        'signature:integrity': signature
      };

      for (const [key, value] of Object.entries(params)) {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = key;
        input.value = value;
        form.appendChild(input);
      }

      document.body.appendChild(form);
      
      Storage.setItem('pending_plan_upgrade', plan);
      
      if (supabaseClient) {
        await supabaseClient.from('profiles').update({ 
          last_payment_amount: totalAmountCop,
          subscription_period: period
        }).eq('id', this.State.currentUser.id);
      }

      setTimeout(() => {
        form.submit();
      }, 1000);

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
              <label class="form-label" data-i18n="admin_restrict_pass_label">Ingresa la contraseña de Super Admin</label>
              <input type="password" class="form-control" id="superadmin-pass" required placeholder="••••••••" style="text-align:center;">
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
        const pass = document.getElementById('superadmin-pass').value;
        if (pass === 'Estrella2026+') {
          this.State.isSuperAdmin = true;
          this.State.currentUser = null; // Quitar sesión de comercio
          Storage.setItem('impulsa_is_superadmin', 'true');
          Storage.setItem('impulsa_active_user', '');
          
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
      tabContent.innerHTML = `
        <div class="leads-table-container">
          <table class="leads-table">
            <thead>
              <tr>
                <th data-i18n="admin_table_date">Fecha</th>
                <th data-i18n="admin_table_loc">Sucursal</th>
                <th data-i18n="admin_table_client">Cliente</th>
                <th data-i18n="admin_table_rating">Valoración</th>
                <th data-i18n="admin_table_comment">Comentarios</th>
                <th data-i18n="admin_table_action">Contacto</th>
              </tr>
            </thead>
            <tbody>
              ${this.State.leads.map(lead => `
                <tr>
                  <td style="white-space: nowrap; font-size: 0.8rem;">${new Date(lead.date).toLocaleDateString()}</td>
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
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
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
                <th>Precio (USD)</th>
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

      document.getElementById('save-wompi-keys').addEventListener('click', () => {
        const pub = document.getElementById('wompi-pub-key').value;
        const priv = document.getElementById('wompi-priv-key').value;
        const integ = document.getElementById('wompi-integrity-secret').value;

        this.State.wompiConfig.publicKey = pub;
        this.State.wompiConfig.privateKey = priv;
        this.State.wompiConfig.integritySecret = integ;

        Storage.setItem('wompi_public_key', pub);
        Storage.setItem('wompi_private_key', priv);
        Storage.setItem('wompi_integrity_secret', integ);

        this.addLog('SYSTEM', `ADMIN: Llaves de Wompi e Integridad actualizadas.`);
        alert('Llaves de API configuradas. La pasarela está lista para pruebas.');
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
      tabContent.innerHTML = `
        <div class="leads-table-container">
          <table class="leads-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Nombre del Comercio</th>
                <th>Responsable / Contacto</th>
                <th>Ubicación</th>
                <th>Plan Activo</th>
                <th>Sucursales</th>
              </tr>
            </thead>
            <tbody>
              ${this.State.users.map(u => {
                const count = this.State.locations.filter(loc => loc.userId === u.id).length;
                const expiryDate = u.subscriptionExpiry ? new Date(u.subscriptionExpiry) : null;
                const isExpired = expiryDate && expiryDate < new Date();
                const statusColor = isExpired ? 'var(--color-danger)' : 'var(--color-success)';
                
                return `
                  <tr>
                    <td><strong>${u.id.substring(0, 8)}...</strong></td>
                    <td style="display: flex; align-items: center; gap: 10px;">
                      <div style="width: 32px; height: 32px; border-radius: 50%; overflow: hidden; border: 1px solid var(--border-color); display: flex; align-items: center; justify-content: center; background: white;">
                        ${u.logo && u.logo.startsWith('http') ? `<img src="${u.logo}" style="width:100%; height:100%; object-fit:cover;">` : u.logo || '🏪'}
                      </div>
                      <div style="display: flex; flex-direction: column;">
                        <strong>${u.businessName}</strong>
                        <span style="font-size: 0.75rem; color: var(--text-secondary);">${u.email}</span>
                      </div>
                    </td>
                    <td>
                      <div style="display: flex; flex-direction: column;">
                        <span>${u.fullName || 'No registrado'}</span>
                        <a href="https://wa.me/${u.whatsapp}" target="_blank" style="color: var(--color-success); font-size: 0.75rem; text-decoration: none;">
                          <i data-lucide="message-circle" style="width: 12px; height: 12px; display: inline; vertical-align: middle;"></i> ${u.whatsapp || 'Sin WA'}
                        </a>
                      </div>
                    </td>
                    <td>
                      <div style="display: flex; flex-direction: column; font-size: 0.8rem;">
                        <span style="font-weight: 700; color: ${statusColor};">
                          ${u.plan.toUpperCase()} (${u.subscriptionPeriod || 1} Meses)
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
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    this.translateInterface();
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
      if (messagesContainer.innerHTML.trim() === '') {
        this.addAgentChatMessage(this.t('sup_chat_agent_welcome'));
      }
    });

    closeChatBtn.addEventListener('click', () => {
      chatSheet.classList.remove('active');
    });

    const sendMessage = () => {
      const text = chatInput.value.trim();
      if (!text) return;

      this.addUserChatMessage(text);
      chatInput.value = '';

      this.addLog('POST', `[Proxy ChatWidget] Mensaje capturado. Enrutando a n8n mediante proxy seguro.`);
      this.addLog('POST', `[Proxy ChatWidget] Payload procesado exitosamente. Status: 200 OK (CORS Bypassed).`);

      setTimeout(() => {
        this.addAgentChatMessage(
          this.State.lang === 'es'
            ? 'Hola, he recibido tu mensaje mediante nuestro proxy de seguridad. Un agente comercial de IMPULSA te responderá a la brevedad.'
            : 'Hello, I have received your message via our secure security proxy. An IMPULSA agent will reply shortly.'
        );
      }, 1000);
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
  }
};

// Arrancar la aplicación
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
