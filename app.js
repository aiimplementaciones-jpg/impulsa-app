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
    proxyLogs: [],      // Logs del Servidor seguro /api/support
    visits: 0           // Semilla global de visitas (Reset a 0 para datos reales)
  },

  // Límites de locales por plan
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
      // 1. Obtener la sesión activa de Supabase
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
          plan: p.plan,
          logo: p.logo,
          accentColor: p.accent_color,
          bgColor: p.bg_color,
          title: p.portal_title || `Opiniones de ${p.business_name}`
        }));
      } else if (this.State.currentUser) {
        this.State.users = [{
          id: this.State.currentUser.id,
          businessName: this.State.currentUser.businessName,
          plan: this.State.currentUser.plan,
          logo: this.State.currentUser.logo,
          accentColor: this.State.currentUser.accentColor,
          bgColor: this.State.currentUser.bgColor,
          title: this.State.currentUser.title
        }];
      }

      this.addLog('SYSTEM', `Sincronización con Supabase exitosa: ${this.State.locations.length} sucursales y ${this.State.leads.length} casos cargados.`);
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
        <div class="phone-simulator-container" style="margin-bottom: 40px; perspective: 1000px;">
          <div class="phone-frame" style="width: 280px; height: 560px; background: #1a1a1a; border-radius: 40px; border: 8px solid #333; margin: 0 auto; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); position: relative; overflow: hidden;">
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

    // 🚀 BYPASS TEMPORAL PARA DESARROLLO
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

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px;">
        <!-- Datos del Perfil -->
        <div class="card">
          <h3 class="card-title"><i data-lucide="user"></i> Datos del Perfil y Contacto</h3>
          <form id="contact-data-form" style="margin-top:16px; display:flex; flex-direction:column; gap:12px;">
            <div class="form-group">
              <label class="form-label">Nombre del Negocio</label>
              <input type="text" class="form-control" id="contact-business" value="${user.businessName || ''}">
            </div>
            <div class="form-group">
              <label class="form-label">WhatsApp para Reportes</label>
              <input type="tel" class="form-control" id="contact-whatsapp" value="${user.whatsapp || ''}">
            </div>
            <div class="form-group">
              <label class="form-label">Dirección (Local)</label>
              <input type="text" class="form-control" id="contact-address" value="${user.address || ''}">
            </div>
            <button type="submit" class="btn btn-secondary">
              <i data-lucide="save"></i> Actualizar Perfil
            </button>
          </form>
        </div>

        <!-- Enlaces Rápidos y QR -->
        <div class="card">
          <h3 class="card-title"><i data-lucide="qr-code"></i> Mi Enlace de Calificación</h3>
          <div style="margin-top: 16px; text-align: center;">
            <p style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 12px;">Usa este enlace en tus redes sociales.</p>
            <div style="background: var(--bg-primary); padding: 12px; border-radius: 8px; border: 1px dashed var(--border-color); font-family: monospace; font-size: 0.8rem; margin-bottom: 16px; word-break: break-all;">
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
      <div style="display: grid; grid-template-columns: 1fr 320px; gap: 20px; margin-bottom: 24px;">
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
        <div class="card" style="padding: 20px; display: flex; flex-direction: column; align-items: center;">
          <h4 style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 12px; text-transform: uppercase;">Vista Previa</h4>
          <div class="phone-simulator-dashboard" style="width: 200px; height: 400px; background: #1a1a1a; border-radius: 30px; border: 6px solid #333; position: relative; overflow: hidden; box-shadow: var(--shadow-lg);">
            <div style="width: 60px; height: 12px; background: #333; position: absolute; top: 0; left: 50%; transform: translateX(-50%); border-bottom-left-radius: 8px; border-bottom-right-radius: 8px; z-index: 2;"></div>
            <div id="sim-screen" style="width: 100%; height: 100%; background: white; display: flex; flex-direction: column; align-items: center; padding: 30px 10px; text-align: center; gap: 10px;">
              <div id="sim-logo" style="width: 50px; height: 50px; border-radius: 50%; border: 2px solid #6366f1; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; overflow:hidden;">
                ${user.logo && user.logo.startsWith('http') ? `<img src="${user.logo}" style="width:100%; height:100%; object-fit:cover;">` : user.logo || '🏪'}
              </div>
              <h5 id="sim-title" style="font-size: 0.8rem; margin: 0; color: #333;">${user.title || 'Mi Negocio'}</h5>
              <p style="font-size: 0.5rem; color: #666;">¿Cómo fue tu experiencia hoy?</p>
              <div style="display: flex; gap: 2px;">
                ${Array.from({ length: 5 }).map(() => `<i data-lucide="star" style="width: 12px; height: 12px; color: #FFD700; fill: #FFD700;"></i>`).join('')}
              </div>
              <div id="sim-button" style="margin-top: auto; width: 100%; background: #6366f1; color: white; padding: 8px; border-radius: 6px; font-size: 0.6rem; font-weight: 700;">
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
        this.handleSaveContactData();
      });
    }

    lucide.createIcons();
    // Aplicar color inicial al simulador
    simButton.style.backgroundColor = colorInput.value;
    simLogoBox.style.borderColor = colorInput.value;
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
              <div class="location-actions" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                <button class="btn btn-secondary download-qr-btn" data-id="${loc.id}" data-name="${loc.name}" style="padding: 8px 12px; font-size: 0.8rem; border-radius: var(--radius-sm);">
                  <i data-lucide="download"></i> QR
                </button>
                <button class="btn btn-secondary print-qr-btn" data-id="${loc.id}" data-name="${loc.name}" style="padding: 8px 12px; font-size: 0.8rem; border-radius: var(--radius-sm);">
                  <i data-lucide="printer"></i> Imprimir
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
    this.addLog('GET', `Generando QR HD para: "${name}"`);

    this.generateQRCodeCanvas(portalUrl, (canvas) => {
      // Crear un canvas final con un diseño tipo tarjeta
      const finalCanvas = document.createElement('canvas');
      finalCanvas.width = 1200;
      finalCanvas.height = 1600;
      const ctx = finalCanvas.getContext('2d');

      // Fondo
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 1200, 1600);

      // Cabecera con Degradado
      const grad = ctx.createLinearGradient(0, 0, 1200, 0);
      grad.addColorStop(0, user.accentColor || '#6366f1');
      grad.addColorStop(1, '#4f46e5');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 1200, 300);

      // Texto "IMPULSA" y Cohete
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 80px sans-serif';
      ctx.fillText('🚀 IMPULSA', 100, 180);

      // Nombre del Negocio
      ctx.fillStyle = '#1f2937';
      ctx.font = 'bold 90px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(user.businessName.toUpperCase(), 600, 480);
      
      ctx.font = '60px sans-serif';
      ctx.fillStyle = '#6b7280';
      ctx.fillText(name, 600, 580);

      // Dibujar el QR
      ctx.drawImage(canvas, 100, 650, 1000, 1000);

      // Pie de página
      ctx.font = '50px sans-serif';
      ctx.fillStyle = '#9ca3af';
      ctx.fillText('¡Tu opinión nos ayuda a mejorar!', 600, 1500);

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
                height: 100vh;
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
                background: linear-gradient(135deg, ${accentColor}, #4f46e5);
                padding: 40px 20px;
                color: white;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 10px;
              }
              .business-logo {
                width: 80px;
                height: 80px;
                background: white;
                border-radius: 20px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 3rem;
                overflow: hidden;
                box-shadow: 0 4px 10px rgba(0,0,0,0.1);
              }
              .business-logo img {
                width: 100%;
                height: 100%;
                object-fit: cover;
              }
              .brand-name {
                font-weight: 800;
                font-size: 1.2rem;
                letter-spacing: 2px;
                opacity: 0.9;
                text-transform: uppercase;
              }
              .content {
                padding: 40px 30px;
              }
              .business-name-main {
                font-weight: 800;
                font-size: 2rem;
                color: #111827;
                margin-bottom: 5px;
                text-transform: uppercase;
              }
              .location-name {
                font-weight: 500;
                font-size: 1.1rem;
                color: #6b7280;
                margin-bottom: 30px;
              }
              .qr-container {
                padding: 20px;
                background: white;
                border-radius: 30px;
                border: 2px dashed ${accentColor}44;
                margin-bottom: 30px;
                display: inline-block;
              }
              .qr-img {
                width: 280px;
                height: 280px;
                display: block;
              }
              .cta-text {
                font-weight: 700;
                font-size: 1.4rem;
                color: #111827;
                margin-bottom: 10px;
              }
              .sub-text {
                font-size: 1rem;
                color: #6b7280;
                line-height: 1.5;
              }
              .footer-decor {
                height: 15px;
                background: linear-gradient(90deg, ${accentColor}, #4f46e5, ${accentColor});
              }
              @media print {
                body { background: white; }
                .stand { box-shadow: none; border: 1px solid #eee; }
              }
            </style>
          </head>
          <body>
            <div class="stand">
              <div class="header">
                <div class="business-logo">
                  ${logo.startsWith('http') ? `<img src="${logo}">` : logo}
                </div>
                <div class="brand-name">IMPULSA</div>
              </div>
              <div class="content">
                <div class="business-name-main">${user.businessName}</div>
                <div class="location-name">${name}</div>
                <div class="qr-container">
                  <img src="${qrDataUrl}" class="qr-img" />
                </div>
                <div class="cta-text">¡Tu opinión nos ayuda a crecer!</div>
                <div class="sub-text">Escanea este código con tu celular y cuéntanos cómo fue tu experiencia hoy.</div>
              </div>
              <div class="footer-decor"></div>
            </div>
            <script>
              window.onload = function() {
                setTimeout(function() { window.print(); window.close(); }, 500);
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
      <div class="portal-container" style="background-color: ${tenant.bgColor || '#ffffff'} !important; min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 20px;">
        <div class="card" style="box-shadow: var(--shadow-md); border-radius: var(--radius-lg); padding: 32px 20px; border-top: 6px solid ${tenant.accentColor || 'var(--color-brand)'}; background-color: white; width: 100%; max-width: 450px;">
          
          <div class="portal-brand">
            <div class="portal-logo-container" style="border-color: ${tenant.accentColor || 'var(--border-color)'}">
              <div style="font-size: 2.2rem; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; overflow: hidden; border-radius: 50%;">
                ${displayLogo.startsWith('http') ? `<img src="${displayLogo}" style="width:100%; height:100%; object-fit:cover;">` : displayLogo}
              </div>
            </div>
            <h2 class="portal-title">${tenant.title}</h2>
            <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 4px; font-weight:600;">${loc.name}</div>
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

      <!-- Filtros por Fechas -->
      <div class="card" style="padding: 16px;">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: flex-end;">
          <div class="form-group" style="margin-bottom: 0;">
            <label class="form-label" data-i18n="stat_date_start">Fecha de inicio</label>
            <input type="date" class="form-control" id="filter-start-date" value="2026-05-01">
          </div>
          <div class="form-group" style="margin-bottom: 0;">
            <label class="form-label" data-i18n="stat_date_end">Fecha final</label>
            <input type="date" class="form-control" id="filter-end-date" value="2026-05-31">
          </div>
        </div>
        
        <div style="margin-top: 14px; display: grid; grid-template-columns: 1fr; gap: 8px;">
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
      this.exportLeadsCSV(userLeads);
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
        
        <!-- PLAN FREE -->
        <div class="pricing-card ${activePlan === 'free' ? 'featured' : ''}">
          ${activePlan === 'free' ? `<span class="pricing-featured-badge" data-i18n="bill_active_tag">Activo</span>` : ''}
          <div class="pricing-header">
            <h3 data-i18n="bill_plan_free">Plan Starter</h3>
            <span style="font-size: 0.8rem; color: var(--text-secondary);" data-i18n="bill_limit_locations" data-i18n-val="1">Límite: 1 sucursal</span>
          </div>
          <div class="pricing-price" data-i18n="bill_price_free">Gratis</div>
          <ul class="pricing-features-list">
            <li><i data-lucide="check"></i> <span data-i18n="bill_feat_1">Indicador LED animado</span></li>
            <li><i data-lucide="check"></i> <span data-i18n="bill_feat_2">Códigos QR de Alta Definición</span></li>
            <li><i data-lucide="check"></i> <span data-i18n="bill_feat_3">Portal móvil personalizable</span></li>
          </ul>
          <button class="btn btn-secondary" disabled style="opacity: 0.5;">
            ${activePlan === 'free' ? 'Plan Activo' : 'Starter'}
          </button>
        </div>

        <!-- PLAN PRO -->
        <div class="pricing-card ${activePlan === 'pro' ? 'featured' : ''}">
          ${activePlan === 'pro' ? `<span class="pricing-featured-badge" data-i18n="bill_active_tag">Activo</span>` : ''}
          <div class="pricing-header">
            <h3 data-i18n="bill_plan_pro">Plan Pro Profesional</h3>
            <span style="font-size: 0.8rem; color: var(--text-secondary);" data-i18n="bill_limit_locations_plural" data-i18n-val="3">Límite: Hasta 3 sucursales</span>
          </div>
          <div class="pricing-price" data-i18n="bill_price_pro">$29 USD / mes</div>
          <ul class="pricing-features-list">
            <li><i data-lucide="check"></i> <span data-i18n="bill_feat_1">Indicador LED animado</span></li>
            <li><i data-lucide="check"></i> <span data-i18n="bill_feat_2">Códigos QR de Alta Definición</span></li>
            <li><i data-lucide="check"></i> <span data-i18n="bill_feat_3">Portal móvil personalizable</span></li>
            <li><i data-lucide="check"></i> <span data-i18n="bill_feat_4">Filtro estratégico de reseñas</span></li>
            <li><i data-lucide="check"></i> <span data-i18n="bill_feat_5">Simulador de servidor de API</span></li>
          </ul>
          <button class="btn btn-primary upgrade-plan-trigger" data-plan="pro" ${activePlan === 'pro' ? 'disabled style="background:var(--bg-primary); color:var(--text-secondary); cursor:default; box-shadow:none;"' : ''}>
            ${activePlan === 'pro' ? 'Plan Activo' : this.t('bill_upgrade_btn')}
          </button>
        </div>

        <!-- PLAN STAR -->
        <div class="pricing-card ${activePlan === 'star' ? 'featured' : ''}">
          ${activePlan === 'star' ? `<span class="pricing-featured-badge" data-i18n="bill_active_tag">Activo</span>` : ''}
          <div class="pricing-header">
            <h3 data-i18n="bill_plan_star">Plan Star Ilimitado</h3>
            <span style="font-size: 0.8rem; color: var(--text-secondary);" data-i18n="bill_limit_unlimited">Sucursales ilimitadas</span>
          </div>
          <div class="pricing-price" data-i18n="bill_price_star">$79 USD / mes</div>
          <ul class="pricing-features-list">
            <li><i data-lucide="check"></i> <span data-i18n="bill_feat_1">Indicador LED animado</span></li>
            <li><i data-lucide="check"></i> <span data-i18n="bill_feat_2">Códigos QR de Alta Definición</span></li>
            <li><i data-lucide="check"></i> <span data-i18n="bill_feat_3">Portal móvil personalizable</span></li>
            <li><i data-lucide="check"></i> <span data-i18n="bill_feat_4">Filtro estratégico de reseñas</span></li>
            <li><i data-lucide="check"></i> <span data-i18n="bill_feat_5">Simulador de servidor de API</span></li>
            <li><i data-lucide="check"></i> <span data-i18n="bill_feat_6">Soporte prioritario</span></li>
          </ul>
          <button class="btn btn-accent upgrade-plan-trigger" data-plan="star" ${activePlan === 'star' ? 'disabled style="background:var(--bg-primary); color:var(--text-secondary); cursor:default; box-shadow:none;"' : ''}>
            ${activePlan === 'star' ? 'Plan Activo' : this.t('bill_upgrade_btn')}
          </button>
        </div>

      </div>
    `;

    document.querySelectorAll('.upgrade-plan-trigger').forEach(btn => {
      btn.addEventListener('click', () => {
        const plan = btn.getAttribute('data-plan');
        this.openCheckoutModal(plan);
      });
    });
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
      const cardNumber = document.getElementById('card-number').value;
      if (cardNumber.length < 14) {
        alert(this.State.lang === 'es' ? 'Ingresa una tarjeta de crédito válida' : 'Enter a valid credit card');
        return;
      }

      formContainer.style.display = 'none';
      processingContainer.style.display = 'block';
      
      this.addLog('POST', `[Pasarela] Iniciando transacción Wompi / Bancolombia para plan: ${plan.toUpperCase()}`);

      if (supabaseClient) {
        const user = this.State.currentUser;
        const { error } = await supabaseClient
          .from('profiles')
          .update({ plan: plan })
          .eq('user_id', user.id);

        if (error) {
          alert("Error al actualizar plan en Supabase: " + error.message);
          modal.classList.remove('active');
          this.renderPageContent('billing');
          return;
        }
        await this.syncFromSupabase();
      } else {
        // Actualizar plan del Tenant comercial activo en el Estado local
        const user = this.State.currentUser;
        user.plan = plan;
        
        // Guardar en la base de datos local
        const idx = this.State.users.findIndex(u => u.id === user.id);
        if (idx !== -1) {
          this.State.users[idx] = user;
          this.saveUsers();
        }
      }

      setTimeout(() => {
        modal.classList.remove('active');
        this.addLog('POST', `[Pasarela] Pago Aprobado. Transacción ID: tx_${Date.now().toString().substring(6)}. Nuevo Plan: ${plan.toUpperCase()}`);
        alert(this.t('bill_success_payment', { plan: plan.toUpperCase() }));
        this.renderPageContent('billing');
      }, 1500);

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
              <input type="password" class="form-control" id="superadmin-pass" required placeholder="Clave de prueba: admin123" style="text-align:center;">
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
        if (pass === 'admin123') {
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
        <button class="admin-tab-btn active" data-tab="leads" data-i18n="admin_leads_tab">Opiniones Globales</button>
        <button class="admin-tab-btn" data-tab="terminal" data-i18n="admin_logs_tab">Consola de Servidor</button>
        <button class="admin-tab-btn" data-tab="tenants" data-i18n="admin_users_tab">Cuentas de Comercios</button>
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
    } else if (tab === 'tenants') {
      this.addLog('GET', `Súper Admin: Auditando base de datos de Tenants registrados`);
      tabContent.innerHTML = `
        <div class="leads-table-container">
          <table class="leads-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Nombre del Comercio</th>
                <th>Correo Electrónico</th>
                <th>Plan Activo</th>
                <th>Sucursales Registradas</th>
              </tr>
            </thead>
            <tbody>
              ${this.State.users.map(u => {
                const count = this.State.locations.filter(loc => loc.userId === u.id).length;
                return `
                  <tr>
                    <td><code>${u.id}</code></td>
                    <td><strong>${u.logo} ${u.businessName}</strong></td>
                    <td><code>${u.email}</code></td>
                    <td><span class="status-badge active" style="background-color:rgba(16,185,129,0.1); color:var(--color-success); text-transform:uppercase; font-size:0.75rem;">${u.plan.toUpperCase()}</span></td>
                    <td>${count} sucursales</td>
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
