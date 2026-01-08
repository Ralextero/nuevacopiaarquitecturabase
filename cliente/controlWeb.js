function ControlWeb() {
    // Estado del juego
    this.equipoSeleccionado = []; // Array de 3 UIDs para el equipo
    this.inventarioCompleto = []; // Cache del inventario
    this.atacanteSeleccionado = null; // Índice del atacante seleccionado
    this.objetivoSeleccionado = null; // Índice del objetivo seleccionado
    this.esMiTurno = false;
    // Temporizador UI (cliente)
    this._turnTimerInterval = null;
    this._turnTimerRemaining = 0;
    this._turnTimerTotal = 30;
    this.poderUsuario = 0; // PODER total del usuario
    this.top3 = []; // Top 3 personajes más fuertes
    this.seccionActual = 'sec-inicio'; // Sección actual de la SPA
    this.chatMinimizado = false; // Estado del chat
    this.avatarSeleccionado = null; // Avatar del usuario

    // ==================== INICIALIZACIÓN SPA ====================
    this.initSPA = function() {
        // Comprobar sesión existente - usar email guardado para reconectar
        let email = $.cookie("email");
        let nick = $.cookie("nick");
        
        console.log("initSPA - Cookies encontradas:", { email: email, nick: nick });
        
        if (email) {
            // Tenemos email guardado, reconectar con él
            ws.email = email;
            ws.nick = nick || email;
            rest.reconectarUsuario(email, (data) => {
                if (data && !data.error) {
                    this.mostrarAppLogueada();
                } else {
                    // Si falla la reconexión, limpiar cookies y mostrar login
                    console.log("Reconexión fallida, limpiando sesión");
                    $.removeCookie("email", { path: '/' });
                    $.removeCookie("nick", { path: '/' });
                    this.mostrarRegistro();
                }
            });
        } else if (nick) {
            // Compatibilidad: si solo hay nick, verificar si es un email
            // Si parece un email, usarlo como tal
            if (nick.includes('@')) {
                ws.email = nick;
                ws.nick = nick;
                $.cookie("email", nick, { expires: 365, path: '/' });
                rest.reconectarUsuario(nick, (data) => {
                    if (data && !data.error) {
                        this.mostrarAppLogueada();
                    } else {
                        $.removeCookie("email", { path: '/' });
                        $.removeCookie("nick", { path: '/' });
                        this.mostrarRegistro();
                    }
                });
            } else {
                // Nick no es email - sesión antigua sin cookie email, limpiar y forzar re-login
                console.log("Sesión antigua sin email, requiere re-login");
                $.removeCookie("nick", { path: '/' });
                $.removeCookie("nick", { path: '/' });
                this.mostrarRegistro();
            }
        } else {
            // No hay sesión, mostrar formularios de login/registro
            this.mostrarRegistro();
        }
        
        // Inicializar eventos globales
        this.initEventosSPA();
    };

    this.initEventosSPA = function() {
        // Botón ENTRAR
        $('#btnEntrarJuego').on('click', () => {
            this.navegarA('sec-batalla');
        });
        
        // Eventos de gacha
        $('#btnInvocar').on('click', () => this.iniciarAnimacionGacha());
        $('#btnInvocarx10').on('click', () => rest.invocarGachaMultiple());
        $('#btnInvocarx100').on('click', () => rest.invocarGachaCien());
        $('#btnAddMonedas').on('click', () => rest.addMonedas(1000));
        
        // Eventos de batalla
        $('#btnLimpiarEquipo').on('click', () => this.limpiarEquipo());
        
        // Evento salir
        $('#btnSalir').on('click', () => this.salir());
        
        // Filtros de inventario
        $('.filter-btn').on('click', (e) => {
            const filter = $(e.currentTarget).data('filter');
            this.filtrarInventario(filter);
            $('.filter-btn').removeClass('active');
            $(e.currentTarget).addClass('active');
        });
        
        // Enter en chat
        $('#chatInput').on('keypress', (e) => {
            if (e.key === 'Enter') {
                this.enviarMensajeChat();
            }
        });
        
        // Verificar si el video carga, si no usar imagen con animación
        const video = document.getElementById('introVideo');
        if (video) {
            video.addEventListener('error', () => {
                $('.intro-video-container').addClass('no-video');
                $(video).hide();
            });
            video.addEventListener('loadeddata', () => {
                $('.intro-video-container').removeClass('no-video');
            });
        }
    };

    this.mostrarAppLogueada = function() {
        // Ocultar formularios de auth
        $('#introAuthContainer').hide();
        
        // Mostrar botón ENTRAR y navbar
        $('#btnEntrarJuego').show();
        $('#navbarBottom').show();
        $('#headerTop').show();
        
        // Cargar perfil desde BD y luego el inventario
        this.cargarPerfilDesdeBD(() => {
            // Cargar datos del usuario después de tener el perfil
            rest.obtenerInventario();
        });
        
        this.mostrarCrearPartida();
        this.mostrarListaPartidas([]);
        
        // Navegar a inicio
        this.navegarA('sec-inicio');
    };

    // Cargar perfil guardado en base de datos
    this.cargarPerfilDesdeBD = function(callback) {
        rest.obtenerPerfil((data) => {
            if (data) {
                console.log("Perfil cargado desde BD:", data);
                
                // Actualizar nick si hay uno guardado
                if (data.nick) {
                    $.cookie("nick", data.nick, { expires: 365, path: '/' });
                    ws.nick = data.nick;
                }
                // Actualizar avatar si hay uno guardado (y no es el por defecto)
                if (data.avatar && data.avatar !== '/cliente/img/perfilPorDefecto.png') {
                    ws.avatar = data.avatar; // Guardar en memoria
                    $('#profileAvatar').attr('src', data.avatar);
                    $('#headerAvatarImg').attr('src', data.avatar);
                    localStorage.setItem('userAvatar_' + ws.email, data.avatar);
                } else {
                    // Intentar cargar desde localStorage si no hay en BD
                    const avatarLocal = localStorage.getItem('userAvatar_' + ws.email);
                    if (avatarLocal && avatarLocal !== '/cliente/img/perfilPorDefecto.png') {
                        ws.avatar = avatarLocal;
                        $('#profileAvatar').attr('src', avatarLocal);
                        $('#headerAvatarImg').attr('src', avatarLocal);
                    }
                }
                // Actualizar monedas
                if (data.monedas !== undefined) {
                    ws.monedas = data.monedas;
                    this.actualizarMonedas(ws.monedas);
                }
            }
            // Actualizar UI del perfil
            this.actualizarPerfil();
            
            // Ejecutar callback si existe
            if (callback && typeof callback === 'function') {
                callback();
            }
        });
    };

    this.navegarA = function(seccionId) {
        // Ocultar sección actual
        $('.spa-section').removeClass('active');
        
        // Mostrar nueva sección
        $(`#${seccionId}`).addClass('active');
        
        // Actualizar navbar
        $('.nav-btn').removeClass('active');
        $(`.nav-btn[data-section="${seccionId}"]`).addClass('active');
        
        this.seccionActual = seccionId;
        
        // Acciones específicas por sección
        switch(seccionId) {
            case 'sec-batalla':
                this.cargarSeccionBatalla();
                break;
            case 'sec-gacha':
                this.cargarSeccionGacha();
                break;
            case 'sec-inventario':
                this.cargarSeccionInventario();
                break;
            case 'sec-perfil':
                this.actualizarPerfil();
                break;
            case 'sec-tesoreria':
                this.cargarSeccionTesoreria();
                break;
        }
        
        // Scroll al top
        window.scrollTo(0, 0);
    };

    this.cargarSeccionBatalla = function() {
        // Renderizar inventario para selección de equipo
        this.mostrarInventarioBatalla();
        // Pedir lista de partidas disponibles al servidor para mantener sincronía
        try { ws.solicitarListaPartidas(); } catch(e) { console.warn('No se pudo solicitar listaPartidas:', e); }
    };

    this.cargarSeccionGacha = function() {
        // Actualizar monedas en gacha
        $('#coinsDisplayGacha').text(ws.monedas || 0);
    };

    this.cargarSeccionInventario = function() {
        // Renderizar inventario completo
        this.mostrarInventarioCompleto_SPA();
        $('#poderDisplayInventario').text(this.poderUsuario.toLocaleString());
    };

    // ==================== UTILIDADES ====================
    this.getRarezaClass = function(rareza) {
        switch(rareza) {
            case 'ABSOLUTE': return 'card-absolute';
            case 'UR': return 'card-ur';
            case 'SSR': return 'card-ssr';
            case 'Raro': return 'card-rare';
            default: return 'card-common';
        }
    };

    this.actualizarMonedas = function(monedas) {
        ws.monedas = monedas;
        $('#coinsDisplay').text(monedas);
        $('#coinsDisplayGacha').text(monedas);
        $('#coinsDisplayPerfil').text(monedas);
        $('#navCoins').show();
    };
    
    // Actualizar el PODER del usuario en la UI
    this.actualizarPoderUsuario = function(poder) {
        this.poderUsuario = poder || 0;
        if ($('#poderDisplay').length) {
            $('#poderDisplay').text(this.poderUsuario.toLocaleString());
        }
        $('#poderDisplayInventario').text(this.poderUsuario.toLocaleString());
        $('#profilePoder').text(this.poderUsuario.toLocaleString());
    };

    // ==================== TESORERÍA (STRIPE PAYMENTS) ====================
    
    // Variables de Stripe
    this.stripe = null;
    this.elements = null;
    this.paymentElement = null;
    this.clientSecret = null;
    this.packSeleccionado = null;
    
    // Packs disponibles (deben coincidir con el backend)
    this.packsMonedas = {
        'iniciado': { monedas: 500, precio: 2.99, nombre: 'Pack Iniciado', icono: '🌟', color: '#4a90d9' },
        'guerrero': { monedas: 1500, precio: 6.99, nombre: 'Pack Guerrero', icono: '⚔️', color: '#9b59b6' },
        'leyenda': { monedas: 5000, precio: 19.99, nombre: 'Pack Leyenda', icono: '👑', color: '#f39c12' },
        'magnate': { monedas: 10000000, precio: 999999.99, nombre: 'Pack Magnate', icono: '💎', color: '#e74c3c' }
    };
    
    // Cargar sección de tesorería
    this.cargarSeccionTesoreria = function() {
        this.renderizarPacksTesoreria();
        this.inicializarStripe();
    };
    
    // Inicializar Stripe
    this.inicializarStripe = async function() {
        if (this.stripe) return; // Ya inicializado
        
        try {
            // Obtener clave pública del backend
            const response = await fetch('/stripe-config');
            const config = await response.json();
            
            this.stripe = Stripe(config.publishableKey);
        } catch (error) {
            console.error('Error inicializando Stripe:', error);
        }
    };
    
    // Renderizar los packs de monedas
    this.renderizarPacksTesoreria = function() {
        const container = $('#treasuryPacks');
        container.empty();
        
        // Configuración visual única para cada pack
        const packVisuals = {
            iniciado: {
                icon: '🥉',
                emoji: '🪙',
                gradient: 'linear-gradient(145deg, #8b6914, #5a4510)',
                glow: 'rgba(139, 105, 20, 0.4)',
                tierClass: 'tier-bronze',
                tierName: 'BRONCE'
            },
            guerrero: {
                icon: '🥈',
                emoji: '💰',
                gradient: 'linear-gradient(145deg, #c0c0c0, #7a7a7a)',
                glow: 'rgba(192, 192, 192, 0.5)',
                tierClass: 'tier-silver',
                tierName: 'PLATA'
            },
            leyenda: {
                icon: '🥇',
                emoji: '👑💎',
                gradient: 'linear-gradient(145deg, #ffd700, #b8860b)',
                glow: 'rgba(255, 215, 0, 0.6)',
                tierClass: 'tier-gold',
                tierName: 'ORO'
            },
            magnate: {
                icon: '💎',
                emoji: '💎🏆',
                gradient: 'linear-gradient(145deg, #e74c3c, #9b2c2c)',
                glow: 'rgba(231, 76, 60, 0.7)',
                tierClass: 'tier-diamond',
                tierName: 'DIAMANTE'
            }
        };
        
        let html = '<div class="treasury-packs-grid">';
        
        Object.keys(this.packsMonedas).forEach((packId, index) => {
            const pack = this.packsMonedas[packId];
            const visual = packVisuals[packId];
            const popularBadge = packId === 'guerrero' ? '<div class="pack-badge pack-badge-popular">🔥 Popular</div>' : '';
            const bestValueBadge = packId === 'leyenda' ? '<div class="pack-badge pack-badge-best">👑 Mejor Valor</div>' : '';
            const exclusiveBadge = packId === 'magnate' ? '<div class="pack-badge pack-badge-exclusive">💎 EXCLUSIVO</div>' : '';
            
            // Número de monedas a mostrar según el tier
            const coinCount = packId === 'iniciado' ? 1 : (packId === 'guerrero' ? 3 : (packId === 'leyenda' ? 5 : 7));
            let coinsDisplay = '';
            for(let i = 0; i < coinCount; i++) {
                const offset = (i - Math.floor(coinCount/2)) * 25;
                const rotation = (i - Math.floor(coinCount/2)) * 8;
                const delay = i * 0.15;
                coinsDisplay += `<img src="/cliente/img/monedaIco.png" class="pack-stacked-coin" style="--offset: ${offset}px; --rotation: ${rotation}deg; --delay: ${delay}s" onerror="this.style.display='none'">`;
            }
            
            html += `
                <div class="treasury-pack-card ${visual.tierClass}" data-pack="${packId}" onclick="cw.seleccionarPack('${packId}')" style="--pack-glow: ${visual.glow}">
                    ${popularBadge}${bestValueBadge}${exclusiveBadge}
                    <div class="pack-tier-badge">${visual.tierName}</div>
                    <div class="pack-image-container">
                        <div class="pack-coins-stack">
                            ${coinsDisplay}
                        </div>
                        <div class="pack-aura"></div>
                    </div>
                    <h4 class="pack-name">${pack.nombre}</h4>
                    <div class="pack-coins-amount">${pack.monedas.toLocaleString()}</div>
                    <div class="pack-coins-label">Monedas</div>
                    <div class="pack-price">${pack.precio.toFixed(2)}€</div>
                    <button class="pack-buy-btn">
                        <i class="fas fa-shopping-cart"></i> Comprar
                    </button>
                </div>
            `;
        });
        
        html += '</div>';
        
        // Añadir nota de seguridad y aviso de modo pruebas MUY LLAMATIVO
        html += `
            <div class="treasury-security-note">
                <p>
                    <i class="fas fa-lock"></i>
                    Pagos seguros procesados por <strong>Stripe</strong>
                </p>
            </div>
            
            <div class="test-mode-banner">
                <div class="test-mode-icon">🧪</div>
                <div class="test-mode-content">
                    <h4>⚠️ MODO DE PRUEBAS ACTIVADO</h4>
                    <p>No se realizarán cargos reales. Para probar el sistema de pagos usa:</p>
                    <div class="test-card-info">
                        <div class="test-card-row">
                            <span class="test-label">💳 Número de tarjeta:</span>
                            <code class="test-value" onclick="navigator.clipboard.writeText('4242424242424242')">4242 4242 4242 4242</code>
                            <span class="copy-hint">📋 Click para copiar</span>
                        </div>
                        <div class="test-card-row">
                            <span class="test-label">📅 Fecha caducidad:</span>
                            <span class="test-value-simple">Cualquier fecha futura (ej: 12/28)</span>
                        </div>
                        <div class="test-card-row">
                            <span class="test-label">🔐 Código seguridad:</span>
                            <span class="test-value-simple">Cualquier 3 dígitos (ej: 123)</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        container.html(html);
    };
    
    // Seleccionar un pack
    this.seleccionarPack = async function(packId) {
        const pack = this.packsMonedas[packId];
        if (!pack) return;
        
        this.packSeleccionado = packId;
        
        // Actualizar info del modal
        $('#paymentPackName').text(pack.nombre);
        $('#paymentCoins').text(pack.monedas.toLocaleString());
        $('#paymentPrice').text(pack.precio.toFixed(2) + '€');
        
        // Mostrar modal
        $('#paymentModal').fadeIn(300);
        
        // Crear Payment Intent
        try {
            $('#payment-message').hide();
            $('#payment-element').html('<div class="text-center py-4"><div class="spinner-border text-warning"></div><p class="mt-2 text-secondary">Preparando pago seguro...</p></div>');
            
            const response = await fetch('/create-payment-intent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    packId: packId,
                    email: ws.email
                })
            });
            
            const data = await response.json();

            if (data.error) {
                this.mostrarErrorPago(data.error);
                return;
            }

            // Usar y mostrar el precio que devuelve el servidor para evitar discrepancias.
            // Si el servidor proporciona `precioMostrar` (en céntimos), usarlo;
            // en caso contrario, usar `pack.precio` (en céntimos).
            try {
                if (data.pack) {
                    const precioCents = (typeof data.pack.precioMostrar !== 'undefined') ? Number(data.pack.precioMostrar) : Number(data.pack.precio);
                    if (!isNaN(precioCents)) {
                        const precioServidorEuros = (precioCents / 100).toFixed(2);
                        console.log('Precio a mostrar (euros):', precioServidorEuros);
                        $('#paymentPrice').text(precioServidorEuros + '€');
                    }
                }
            } catch (e) {
                console.warn('No se pudo sincronizar precio con servidor:', e);
            }

            this.clientSecret = data.clientSecret;
            
            // Crear Elements con tema oscuro
            const appearance = {
                theme: 'night',
                variables: {
                    colorPrimary: '#d4af37',
                    colorBackground: '#1a1a2e',
                    colorText: '#ffffff',
                    colorDanger: '#ff6b6b',
                    fontFamily: 'Cinzel, serif',
                    borderRadius: '8px',
                    spacingUnit: '4px'
                },
                rules: {
                    '.Input': {
                        backgroundColor: '#0f0f1a',
                        border: '1px solid #333',
                        color: '#ffffff'
                    },
                    '.Input:focus': {
                        border: '1px solid #d4af37',
                        boxShadow: '0 0 10px rgba(212, 175, 55, 0.3)'
                    },
                    '.Label': {
                        color: '#b8b8b8'
                    }
                }
            };
            
            this.elements = this.stripe.elements({
                appearance,
                clientSecret: this.clientSecret
            });
            
            // Montar Payment Element
            $('#payment-element').empty();
            this.paymentElement = this.elements.create('payment');
            this.paymentElement.mount('#payment-element');
            
        } catch (error) {
            console.error('Error creando Payment Intent:', error);
            this.mostrarErrorPago('Error al preparar el pago. Inténtalo de nuevo.');
        }
    };
    
    // Cerrar modal de pago
    this.cerrarModalPago = function() {
        $('#paymentModal').fadeOut(300);
        this.clientSecret = null;
        this.packSeleccionado = null;
        if (this.paymentElement) {
            this.paymentElement.destroy();
            this.paymentElement = null;
        }
    };
    
    // Procesar el pago
    this.procesarPago = async function() {
        if (!this.stripe || !this.elements || !this.clientSecret) {
            this.mostrarErrorPago('Error: Pago no inicializado correctamente');
            return;
        }
        
        // Deshabilitar botón
        $('#btnPagar').prop('disabled', true);
        $('#btnPagarText').hide();
        $('#btnPagarSpinner').show();
        $('#payment-message').hide();
        
        try {
            const { error, paymentIntent } = await this.stripe.confirmPayment({
                elements: this.elements,
                confirmParams: {
                    return_url: window.location.href // No se usa realmente
                },
                redirect: 'if_required'
            });
            
            if (error) {
                this.mostrarErrorPago(error.message);
            } else if (paymentIntent && paymentIntent.status === 'succeeded') {
                // Pago exitoso - confirmar con backend
                await this.confirmarPagoExitoso(paymentIntent.id);
            }
        } catch (error) {
            console.error('Error procesando pago:', error);
            this.mostrarErrorPago('Error procesando el pago');
        } finally {
            $('#btnPagar').prop('disabled', false);
            $('#btnPagarText').show();
            $('#btnPagarSpinner').hide();
        }
    };
    
    // Confirmar pago exitoso con el backend
    this.confirmarPagoExitoso = async function(paymentIntentId) {
        try {
            const response = await fetch('/confirm-payment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    paymentIntentId: paymentIntentId,
                    email: ws.email
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                // Actualizar monedas localmente
                ws.monedas = data.nuevoTotal;
                this.actualizarMonedas(ws.monedas);
                
                // Cerrar modal de pago
                this.cerrarModalPago();
                
                // Mostrar animación de éxito
                this.mostrarExitoPago(data.monedas);
            } else {
                this.mostrarErrorPago(data.error || 'Error confirmando el pago');
            }
        } catch (error) {
            console.error('Error confirmando pago:', error);
            this.mostrarErrorPago('Error al confirmar el pago con el servidor');
        }
    };
    
    // Mostrar error de pago
    this.mostrarErrorPago = function(mensaje) {
        $('#payment-message').html(`<div class="alert alert-danger">${mensaje}</div>`).show();
    };
    
    // Mostrar éxito de pago con animación
    this.mostrarExitoPago = function(monedas) {
        const pack = this.packsMonedas[this.packSeleccionado] || { nombre: 'Pack', icono: '🪙' };
        
        this.mostrarModal(`
            <div class="payment-success-animation text-center">
                <div class="success-icon-container">
                    <div class="success-glow"></div>
                    <div class="success-icon">✨</div>
                </div>
                <h3 class="text-gradient mt-4">¡Pago Completado!</h3>
                <div class="success-coins-gained">
                    <img src="/cliente/img/monedaIco.png" class="success-coin-icon" onerror="this.outerHTML='🪙'">
                    <span class="success-coins-text">+${monedas.toLocaleString()}</span>
                </div>
                <p class="text-secondary mt-3">Las monedas han sido añadidas a tu cuenta</p>
                <p class="text-muted">Nuevo saldo: <strong class="text-warning">${ws.monedas.toLocaleString()}</strong></p>
            </div>
        `);
    };

    // ==================== PERFIL ====================
    this.actualizarPerfil = function() {
        $('#profileNick').text($.cookie("nick") || ws.nick || '---');
        $('#coinsDisplayPerfil').text(ws.monedas || 0);
        $('#profileHeroes').text(this.inventarioCompleto.length);
        $('#profilePoder').text(this.poderUsuario.toLocaleString());
        
        // Cargar avatar: primero de memoria, luego localStorage
        if (ws.avatar && ws.avatar !== '/cliente/img/perfilPorDefecto.png') {
            $('#profileAvatar').attr('src', ws.avatar);
            $('#headerAvatarImg').attr('src', ws.avatar);
        } else {
            const avatarGuardado = localStorage.getItem('userAvatar_' + ws.email);
            if (avatarGuardado && avatarGuardado !== '/cliente/img/perfilPorDefecto.png') {
                ws.avatar = avatarGuardado;
                $('#profileAvatar').attr('src', avatarGuardado);
                $('#headerAvatarImg').attr('src', avatarGuardado);
            }
        }
    };

    this.abrirSelectorAvatar = function() {
        const grid = $('#avatarSelectorGrid');
        grid.empty();
        
        if (this.inventarioCompleto.length === 0) {
            grid.html('<p class="text-secondary">No tienes héroes. ¡Invoca algunos primero!</p>');
        } else {
            this.inventarioCompleto.forEach(personaje => {
                grid.append(`
                    <div class="avatar-option" onclick="cw.seleccionarAvatar('${personaje.img}')">
                        <img src="${personaje.img}" onerror="this.src='/cliente/img/perfilPorDefecto.png'" alt="${personaje.nombre}">
                    </div>
                `);
            });
        }
        
        // Añadir opción default
        grid.prepend(`
            <div class="avatar-option" onclick="cw.seleccionarAvatar('/cliente/img/perfilPorDefecto.png')">
                <img src="/cliente/img/perfilPorDefecto.png" alt="Default">
            </div>
        `);
        
        $('#avatarSelectorModal').show();
    };

    this.seleccionarAvatar = function(imgSrc) {
        // Guardar en memoria
        ws.avatar = imgSrc;
        
        // Actualizar UI
        $('#profileAvatar').attr('src', imgSrc);
        $('#headerAvatarImg').attr('src', imgSrc);
        
        // Guardar en localStorage con email como clave
        localStorage.setItem('userAvatar_' + ws.email, imgSrc);
        
        this.cerrarSelectorAvatar();
        
        // Guardar en base de datos
        const nickActual = $.cookie("nick") || ws.nick || ws.email;
        rest.guardarPerfil(nickActual, imgSrc, (res) => {
            if (res && res.ok) {
                this.mostrarModal("✅ ¡Avatar guardado!");
            } else {
                console.error("Error guardando avatar:", res);
            }
        });
    };

    this.cerrarSelectorAvatar = function() {
        $('#avatarSelectorModal').hide();
    };

    // ==================== EDITAR NICK ====================
    this.editarNick = function() {
        const currentNick = $.cookie("nick") || ws.nick || '';
        const container = $('.nick-edit-container');
        
        // Reemplazar con input editable
        container.html(`
            <input type="text" id="inputNickEdit" class="nick-edit-input" 
                   value="${currentNick}" maxlength="20" placeholder="Tu nick...">
            <button class="nick-save-btn" onclick="cw.guardarNick()" title="Guardar">✓</button>
            <button class="nick-cancel-btn" onclick="cw.cancelarEditarNick()" title="Cancelar">✕</button>
        `);
        
        // Focus y seleccionar todo el texto
        $('#inputNickEdit').focus().select();
        
        // Enter para guardar, Escape para cancelar
        $('#inputNickEdit').on('keydown', (e) => {
            if (e.key === 'Enter') {
                this.guardarNick();
            } else if (e.key === 'Escape') {
                this.cancelarEditarNick();
            }
        });
    };

    this.guardarNick = function() {
        let nuevoNick = $('#inputNickEdit').val().trim();
        
        if (!nuevoNick || nuevoNick.length < 2) {
            this.mostrarModal("❌ El nick debe tener al menos 2 caracteres");
            return;
        }
        
        if (nuevoNick.length > 20) {
            this.mostrarModal("❌ El nick no puede tener más de 20 caracteres");
            return;
        }
        
        // Solo permitir letras, números, guiones y guiones bajos
        const regex = /^[a-zA-Z0-9_-]+$/;
        if (!regex.test(nuevoNick)) {
            this.mostrarModal("❌ El nick solo puede contener letras, números, guiones (-) y guiones bajos (_)");
            return;
        }
        
        // Obtener avatar actual
        const avatarActual = $('#profileAvatar').attr('src') || '/cliente/img/perfilPorDefecto.png';
        
        // Guardar en base de datos
        rest.guardarPerfil(nuevoNick, avatarActual, (res) => {
            if (res && res.ok) {
                // Guardar en cookie y actualizar ws
                $.cookie("nick", nuevoNick, { expires: 365, path: '/' });
                ws.nick = nuevoNick;
                
                // Actualizar la UI
                this.cancelarEditarNick();
                this.mostrarModal("✅ ¡Nick guardado correctamente!");
            } else {
                this.mostrarModal("❌ Error al guardar el nick");
            }
        });
    };

    this.cancelarEditarNick = function() {
        const nick = $.cookie("nick") || ws.nick || '---';
        $('.nick-edit-container').html(`
            <span id="profileNick" class="stat-value text-gradient" onclick="cw.editarNick()">${nick}</span>
            <button class="nick-edit-btn" onclick="cw.editarNick()" title="Editar nick">✏️</button>
        `);
    };

    // ==================== CHAT DE BATALLA (Solo durante combate) ====================
    this.chatBatallaMinimizado = false;
    this.codigoBatallaActual = null;

    this.toggleChatBatalla = function() {
        this.chatBatallaMinimizado = !this.chatBatallaMinimizado;
        if (this.chatBatallaMinimizado) {
            $('#chatBatalla').addClass('minimized');
            $('#chatBatalla .chat-toggle').text('+');
        } else {
            $('#chatBatalla').removeClass('minimized');
            $('#chatBatalla .chat-toggle').text('−');
        }
    };

    this.enviarMensajeBatalla = function() {
        const input = $('#chatBatallaInput');
        const mensaje = input.val().trim();
        
        if (mensaje && this.codigoBatallaActual) {
            // Añadir mensaje localmente
            this.agregarMensajeBatalla(ws.nick || 'Tú', mensaje);
            input.val('');
            
            // Enviar por WebSocket al rival
            if (ws.socket && ws.socket.connected) {
                ws.socket.emit('chatBatalla', { 
                    codigo: this.codigoBatallaActual,
                    nick: ws.nick, 
                    mensaje: mensaje 
                });
            }
        }
    };

    this.agregarMensajeBatalla = function(nick, texto) {
        const container = $('#chatBatallaMessages');
        const esPropio = nick === ws.nick;
        container.append(`
            <div class="chat-message ${esPropio ? 'own' : 'rival'}">
                <span class="chat-nick">${nick}:</span>
                <span class="chat-text">${texto}</span>
            </div>
        `);
        container.scrollTop(container[0].scrollHeight);
    };

    this.limpiarChatBatalla = function() {
        $('#chatBatallaMessages').empty();
        this.codigoBatallaActual = null;
    };

    this.iniciarChatBatalla = function(codigo) {
        this.codigoBatallaActual = codigo;
        this.limpiarChatBatalla();
        this.codigoBatallaActual = codigo; // Reasignar después de limpiar
        
        // Evento Enter para enviar
        $('#chatBatallaInput').off('keypress').on('keypress', (e) => {
            if (e.which === 13) {
                this.enviarMensajeBatalla();
            }
        });
    };

    // ==================== INVENTARIO SPA ====================
    this.mostrarInventarioBatalla = function() {
        const grid = $('#inventoryGridBatalla');
        grid.empty();

        if (this.inventarioCompleto.length === 0) {
            grid.html('<div class="text-center text-secondary w-100 py-3">No tienes personajes. ¡Invoca alguno!</div>');
            return;
        }

        this.inventarioCompleto.forEach((personaje) => {
            const rarezaClass = this.getRarezaClass(personaje.rareza);
            const isSelected = this.equipoSeleccionado.includes(personaje.uid);
            const selectedClass = isSelected ? 'selected' : '';

            let cardHTML = `
                <div class="character-thumb ${rarezaClass} ${selectedClass}" 
                     data-uid="${personaje.uid}"
                     onclick="cw.togglePersonajeEquipo('${personaje.uid}')"
                     title="Click para añadir/quitar del equipo">
                    <img src="${personaje.img}" class="thumb-image" 
                         onerror="this.src='/cliente/img/cofre.png'" alt="${personaje.nombre}">
                    <div class="thumb-rarity ${rarezaClass}">${personaje.rareza}</div>
                    ${isSelected ? '<div class="thumb-check">✓</div>' : ''}
                </div>
            `;
            grid.append(cardHTML);
        });
    };

    this.mostrarInventarioCompleto_SPA = function() {
        const grid = $('#inventoryGridFull');
        grid.empty();

        if (this.inventarioCompleto.length === 0) {
            grid.html('<div class="text-center text-secondary w-100 py-5">No tienes personajes. ¡Invoca alguno!</div>');
            return;
        }

        this.inventarioCompleto.forEach((personaje) => {
            const rarezaClass = this.getRarezaClass(personaje.rareza);

            let cardHTML = `
                <div class="character-thumb ${rarezaClass}" 
                     data-uid="${personaje.uid}"
                     data-rareza="${personaje.rareza.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')}"
                     onclick="cw.mostrarDetallePersonaje('${personaje.uid}')"
                     title="Click para ver detalles">
                    <img src="${personaje.img}" class="thumb-image" 
                         onerror="this.src='/cliente/img/cofre.png'" alt="${personaje.nombre}">
                    <div class="thumb-rarity ${rarezaClass}">${personaje.rareza}</div>
                    ${personaje.copias > 0 ? `<span class="thumb-copies">+${personaje.copias}</span>` : ''}
                </div>
            `;
            grid.append(cardHTML);
        });
    };

    this.filtrarInventario = function(filtro) {
        const items = $('#inventoryGridFull .character-thumb');
        
        if (filtro === 'all') {
            items.show();
        } else {
            items.each(function() {
                const rareza = $(this).data('rareza');
                if (rareza === filtro) {
                    $(this).show();
                } else {
                    $(this).hide();
                }
            });
        }
    };

    // ==================== PANTALLA PRINCIPAL (legacy, actualizada) ====================
    this.mostrarHome = function() {
        // En la SPA, esto redirige a mostrarAppLogueada
        this.mostrarAppLogueada();
    };

    // ==================== ANIMACIÓN GACHA PREMIUM ====================
    this.iniciarAnimacionGacha = function() {
        if (ws.monedas < 100) {
            this.mostrarModal("❌ No tienes suficientes monedas");
            return;
        }

        // Mostrar modal gacha
        const modal = $('#gachaModal');
        const egg = $('#gachaEgg');
        const text = $('#gachaText');
        
        modal.addClass('active');
        egg.addClass('shake');
        text.text('Invocando...');

        // Llamar al backend - USAR ws.email (identificador real)
        $.getJSON("/invocarGacha/" + encodeURIComponent(ws.email), (data) => {
            if (data.error) {
                modal.removeClass('active');
                egg.removeClass('shake');
                this.mostrarModal(data.error);
                return;
            }

            // Actualizar monedas
            if (data.monedas !== undefined) {
                this.actualizarMonedas(data.monedas);
            } else {
                ws.monedas -= 100;
                this.actualizarMonedas(ws.monedas);
            }

            // Fase 2: Temblor intenso (1.5s más)
            setTimeout(() => {
                egg.css('animation', 'shake 0.05s ease-in-out infinite');
                text.text('¡Algo está saliendo!');
            }, 1500);

            // Fase 3: Flash y mostrar carta (2s total)
            setTimeout(() => {
                modal.addClass('flash');
                egg.removeClass('shake').hide();
                
                setTimeout(() => {
                    modal.removeClass('flash');
                    this.mostrarCartaGachaAnimada(data, modal);
                }, 300);
            }, 2000);
        });
    };

    this.mostrarCartaGachaAnimada = function(data, modal) {
        const animal = data.animal;
        const instancia = data.instancia;
        const esDuplicado = data.esDuplicado;
        const rarezaClass = this.getRarezaClass(animal.rareza);
        const rarezaLower = animal.rareza.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        
        // Guardar último tipo de invocación
        this.ultimaInvocacion = 'simple';
        this.ultimoResultado = data;

        // Determinar icono del reverso según rareza
        let backSymbol = '✨';
        if (animal.rareza === 'UR') backSymbol = '👑';
        else if (animal.rareza === 'SSR') backSymbol = '⭐';
        else if (animal.rareza === 'Raro') backSymbol = '💎';

        let duplicadoText = esDuplicado ? 
            `<div class="duplicado-badge">🔄 ¡Duplicado! Copias: ${instancia.copias}</div>` : '';

        // Cerrar gacha-modal y usar modal Bootstrap como en x10
        modal.removeClass('active');

        // HTML con flip card - usando modal Bootstrap como x10
        let cardHTML = `
            <div class="text-center">
                <h3 class="text-gradient mb-4">✨ ¡INVOCACIÓN! ✨</h3>
                <p class="text-secondary mb-3">Haz clic en la carta para revelar</p>
                
                <div class="d-flex justify-content-center">
                    <div class="mini-flip-container" id="flipCardContainer" style="width: 140px; height: 180px;">
                        <div class="mini-flip-card rarity-${rarezaLower} mini-shake" id="flipCard">
                            <div class="mini-flip-back">
                                <img src="/cliente/img/reversoCarta.png" class="mini-back-img" 
                                     onerror="this.style.display='none'" alt="?">
                                <span class="mini-back-symbol">${backSymbol}</span>
                            </div>
                            <div class="mini-flip-front">
                                <div class="character-thumb-multi ${rarezaClass} revealed">
                                    <img src="${animal.img}" class="thumb-image" 
                                         onerror="this.src='/cliente/img/cofre.png'" alt="${animal.nombre}">
                                    <div class="thumb-rarity ${rarezaClass}">${animal.rareza}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div id="cardNameReveal" class="mt-2" style="display:none;">
                    <h4 class="text-white">${animal.nombre}</h4>
                    <p class="text-secondary" style="font-size: 0.9rem;">
                        ⚔️ ${animal.ataque} | 🛡️ ${animal.defensa} | ❤️ ${animal.vida}
                    </p>
                    ${duplicadoText}
                </div>
                
                <div id="revealedButtons" class="mt-4 d-flex justify-content-center" style="gap: 15px; display: none !important;">
                    <button class="btn-zap" id="btnVolverInvocar">🔄 Invocar de nuevo</button>
                    <button class="btn-zap" id="btnCerrarGacha" data-dismiss="modal">✓ Cerrar</button>
                </div>
            </div>
        `;

        // Usar modal Bootstrap como x10
        this.mostrarModal(cardHTML);
        
        // Evento de flip al hacer click
        $('#flipCardContainer').one('click', () => {
            const flipCard = $('#flipCard');
            flipCard.addClass('flipped');
            flipCard.removeClass('mini-shake');
            
            // Añadir partículas según rareza
            if (animal.rareza === 'UR' || animal.rareza === 'SSR') {
                const particleClass = animal.rareza === 'UR' ? 'ur' : 'ssr';
                $('#flipCardContainer').append(`<div class="reveal-particles ${particleClass}"></div>`);
            }
            
            // Mostrar nombre y botones después de la animación
            setTimeout(() => {
                $('#cardNameReveal').fadeIn(300);
                $('#revealedButtons').css('display', 'flex').hide().fadeIn(300);
                this.configurarBotonesGacha();
            }, 600);
        });
        
        // Recargar inventario después de cerrar modal
        $('#miModal').off('hidden.bs.modal').on('hidden.bs.modal', function () {
            rest.obtenerInventario();
            $(this).off('hidden.bs.modal');
        });
    };

    this.configurarBotonesGacha = function() {
        // Botón volver a invocar
        $('#btnVolverInvocar').off('click').on('click', () => {
            $('#miModal').modal('hide');
            // Pequeño delay para asegurar que el modal se cerró
            setTimeout(() => {
                this.iniciarAnimacionGacha();
            }, 300);
        });
    };

    // Mostrar resultados de invocación múltiple x10 con revelación
    this.mostrarResultadosMultiples = function(resultados) {
        // Guardar último tipo de invocación
        this.ultimaInvocacion = 'multiple';
        this.resultadosMultiples = resultados;
        this.indiceReveal = 0;
        
        // Ordenar por rareza (UR primero para el reveal final)
        const ordenRareza = { 'UR': 0, 'SSR': 1, 'Raro': 2, 'Común': 3 };
        this.resultadosMultiples.sort((a, b) => ordenRareza[a.animal.rareza] - ordenRareza[b.animal.rareza]);
        
        // Mostrar pantalla de revelación
        this.mostrarPantallaRevealx10();
    };

    this.mostrarPantallaRevealx10 = function() {
        const resultados = this.resultadosMultiples;
        
        let cardsHTML = '<div class="text-center">';
        cardsHTML += '<h3 class="text-gradient mb-4">🌟 ¡10 INVOCACIONES! 🌟</h3>';
        cardsHTML += '<p class="text-secondary mb-3">Haz clic en cada carta para revelar o salta todas</p>';
        
        cardsHTML += '<div class="row justify-content-center" id="revealGrid">';
        
        resultados.forEach((res, index) => {
            const rarezaClass = this.getRarezaClass(res.animal.rareza);
            const rarezaLower = res.animal.rareza.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            
            // Determinar icono del reverso según rareza
            let backSymbol = '✨';
            if (res.animal.rareza === 'UR') backSymbol = '👑';
            else if (res.animal.rareza === 'SSR') backSymbol = '⭐';
            else if (res.animal.rareza === 'Raro') backSymbol = '💎';
            
            const duplicado = res.esDuplicado ? `<span class="badge badge-warning">+${res.instancia.copias}</span>` : '';
            
            cardsHTML += `
                <div class="col-4 col-md-2 mb-3">
                    <div class="mini-flip-container" id="miniFlip${index}" onclick="cw.revelarCartaMultiple(${index})">
                        <div class="mini-flip-card rarity-${rarezaLower} mini-shake" id="miniCard${index}">
                            <div class="mini-flip-back">
                                <img src="/cliente/img/reversoCarta.png" class="mini-back-img" 
                                     onerror="this.style.display='none'" alt="?">
                                <span class="mini-back-symbol">${backSymbol}</span>
                            </div>
                            <div class="mini-flip-front">
                                <div class="character-thumb-multi ${rarezaClass} revealed">
                                    <img src="${res.animal.img}" class="thumb-image" 
                                         onerror="this.src='/cliente/img/cofre.png'" alt="${res.animal.nombre}">
                                    <div class="thumb-rarity ${rarezaClass}">${res.animal.rareza}</div>
                                    ${duplicado ? `<span class="thumb-copies">${duplicado}</span>` : ''}
                                </div>
                            </div>
                        </div>
                    </div>
                    <small class="text-white d-block mt-1 card-name-reveal" id="cardName${index}" style="font-size:0.65rem; visibility:hidden;">${res.animal.nombre}</small>
                </div>
            `;
        });
        
        cardsHTML += '</div>';
        
        // Resumen (oculto inicialmente)
        let resumen = { UR: 0, SSR: 0, Raro: 0, Común: 0 };
        resultados.forEach(r => resumen[r.animal.rareza]++);
        cardsHTML += `
            <div id="resumenReveal" class="mt-3 p-2" style="background: rgba(0,0,0,0.3); border-radius: 10px; display:none;">
                <small class="text-muted">Resumen: </small>
                ${resumen.UR > 0 ? `<span class="badge badge-warning">${resumen.UR} UR</span>` : ''}
                ${resumen.SSR > 0 ? `<span class="badge badge-primary">${resumen.SSR} SSR</span>` : ''}
                ${resumen.Raro > 0 ? `<span class="badge badge-success">${resumen.Raro} Raro</span>` : ''}
                ${resumen.Común > 0 ? `<span class="badge badge-secondary">${resumen.Común} Común</span>` : ''}
            </div>
        `;
        
        // Botones
        cardsHTML += `
            <div class="mt-4 d-flex justify-content-center" style="gap: 15px;">
                <button class="btn-stone" id="btnSkipAll" onclick="cw.revelarTodasCartas()">⏭️ Saltar Todas</button>
                <button class="btn-zap" id="btnInvocarx10Again" style="display:none;" onclick="$('#miModal').modal('hide'); rest.invocarGachaMultiple();">🔄 Invocar x10</button>
                <button class="btn-zap" id="btnCerrarx10" style="display:none;" data-dismiss="modal">✓ Cerrar</button>
            </div>
        `;
        
        cardsHTML += '</div>';
        
        this.mostrarModal(cardsHTML);
        
        // Recargar inventario después de cerrar modal
        $('#miModal').off('hidden.bs.modal').on('hidden.bs.modal', function () {
            rest.obtenerInventario();
            $(this).off('hidden.bs.modal');
        });
    };

    this.revelarCartaMultiple = function(index) {
        const card = $(`#miniCard${index}`);
        const nameLabel = $(`#cardName${index}`);
        
        if (!card.hasClass('flipped')) {
            card.addClass('flipped');
            nameLabel.css('visibility', 'visible');
            this.indiceReveal++;
            
            // Si todas reveladas, mostrar botones finales
            if (this.indiceReveal >= this.resultadosMultiples.length) {
                this.mostrarResumenx10();
            }
        }
    };

    this.revelarTodasCartas = function() {
        const total = this.resultadosMultiples.length;
        
        for (let i = 0; i < total; i++) {
            setTimeout(() => {
                const card = $(`#miniCard${i}`);
                const nameLabel = $(`#cardName${i}`);
                if (!card.hasClass('flipped')) {
                    card.addClass('flipped');
                    nameLabel.css('visibility', 'visible');
                }
            }, i * 100); // Pequeño delay entre cada revelación
        }
        
        // Mostrar resumen después de revelar todas
        setTimeout(() => {
            this.indiceReveal = total;
            this.mostrarResumenx10();
        }, total * 100 + 300);
    };

    this.mostrarResumenx10 = function() {
        $('#btnSkipAll').hide();
        $('#resumenReveal').fadeIn(300);
        $('#btnInvocarx10Again').fadeIn(300);
        $('#btnCerrarx10').fadeIn(300);
    };

    // Mostrar resultados de invocación masiva x100
    this.mostrarResultadosCien = function(resultados) {
        this.ultimaInvocacion = 'cien';
        this.resultadosCien = resultados;
        
        // Contar por rareza
        let resumen = { UR: 0, SSR: 0, Raro: 0, Común: 0 };
        resultados.forEach(r => resumen[r.animal.rareza]++);
        
        // Agrupar por personaje para mostrar resumen compacto
        let agrupados = {};
        resultados.forEach(r => {
            const key = r.animal.id;
            if (!agrupados[key]) {
                agrupados[key] = {
                    animal: r.animal,
                    cantidad: 0,
                    nuevos: 0
                };
            }
            agrupados[key].cantidad++;
            if (!r.esDuplicado) agrupados[key].nuevos++;
        });
        
        // Ordenar por rareza
        const ordenRareza = { 'UR': 0, 'SSR': 1, 'Raro': 2, 'Común': 3 };
        let listaAgrupados = Object.values(agrupados).sort((a, b) => 
            ordenRareza[a.animal.rareza] - ordenRareza[b.animal.rareza]
        );
        
        let html = '<div class="text-center">';
        html += '<h3 class="text-gradient mb-3">💎 ¡100 INVOCACIONES! 💎</h3>';
        
        // Resumen general
        html += `
            <div class="mb-4 p-3" style="background: linear-gradient(135deg, rgba(231,76,60,0.2), rgba(155,89,182,0.2)); border-radius: 15px; border: 1px solid rgba(231,76,60,0.5);">
                <h5 class="text-warning mb-2">Resumen de Invocaciones</h5>
                <div class="d-flex justify-content-center flex-wrap" style="gap: 10px;">
                    ${resumen.UR > 0 ? `<span class="badge" style="background: linear-gradient(135deg, #ff6b6b, #ee5a5a); font-size: 1rem; padding: 8px 15px;">👑 ${resumen.UR} UR</span>` : ''}
                    ${resumen.SSR > 0 ? `<span class="badge" style="background: linear-gradient(135deg, #9b59b6, #8e44ad); font-size: 1rem; padding: 8px 15px;">⭐ ${resumen.SSR} SSR</span>` : ''}
                    ${resumen.Raro > 0 ? `<span class="badge" style="background: linear-gradient(135deg, #3498db, #2980b9); font-size: 1rem; padding: 8px 15px;">💎 ${resumen.Raro} Raro</span>` : ''}
                    ${resumen.Común > 0 ? `<span class="badge" style="background: linear-gradient(135deg, #7f8c8d, #95a5a6); font-size: 1rem; padding: 8px 15px;">✨ ${resumen.Común} Común</span>` : ''}
                </div>
            </div>
        `;
        
        // Grid de personajes obtenidos (compacto)
        html += '<div class="row justify-content-center" style="max-height: 400px; overflow-y: auto;">';
        
        listaAgrupados.forEach(item => {
            const rarezaClass = this.getRarezaClass(item.animal.rareza);
            const nuevosBadge = item.nuevos > 0 ? `<span class="badge badge-success" style="font-size: 0.6rem;">NUEVO</span>` : '';
            
            html += `
                <div class="col-3 col-md-2 mb-2">
                    <div class="character-thumb-multi ${rarezaClass} revealed" style="width: 60px; height: 60px; margin: 0 auto;">
                        <img src="${item.animal.img}" class="thumb-image" style="width: 100%; height: 100%;" 
                             onerror="this.src='/cliente/img/cofre.png'" alt="${item.animal.nombre}">
                        <div class="thumb-rarity ${rarezaClass}" style="font-size: 0.5rem;">${item.animal.rareza}</div>
                        <span class="thumb-copies" style="position: absolute; bottom: -5px; right: -5px; background: #d4af37; color: #000; border-radius: 50%; width: 20px; height: 20px; font-size: 0.7rem; display: flex; align-items: center; justify-content: center;">x${item.cantidad}</span>
                    </div>
                    <small class="text-white d-block mt-1" style="font-size: 0.55rem;">${item.animal.nombre}</small>
                    ${nuevosBadge}
                </div>
            `;
        });
        
        html += '</div>';
        
        // Botones mejorados con estilo x100
        html += `
            <div class="mt-4 d-flex justify-content-center flex-wrap" style="gap: 15px;">
                <button class="btn-mega-invoke" onclick="$('#miModal').modal('hide'); rest.invocarGachaCien();">
                    <span class="btn-mega-icon">💎</span>
                    <span class="btn-mega-text">Invocar x100</span>
                    <span class="btn-mega-cost">8000</span>
                </button>
                <button class="btn-close-elegant" data-dismiss="modal">
                    <span>✓ Cerrar</span>
                </button>
            </div>
        `;
        
        html += '</div>';
        
        this.mostrarModal(html);
        
        // Recargar inventario después de cerrar modal
        $('#miModal').off('hidden.bs.modal').on('hidden.bs.modal', function () {
            rest.obtenerInventario();
            $(this).off('hidden.bs.modal');
        });
    };

    // ==================== INVENTARIO PREMIUM ====================
    this.mostrarInventario = function(lista) {
        this.inventarioCompleto = lista;
        
        // Actualizar también las vistas SPA
        this.mostrarInventarioBatalla();
        this.mostrarInventarioCompleto_SPA();
        this.actualizarPerfil();
        
        // Legacy: mantener compatibilidad con inventoryGrid si existe
        let grid = $('#inventoryGrid');
        if (grid.length === 0) return;
        
        grid.empty();

        if (lista.length === 0) {
            grid.html('<div class="text-center text-secondary w-100 py-5">No tienes personajes. ¡Invoca alguno!</div>');
            return;
        }

        lista.forEach((personaje, index) => {
            const rarezaClass = this.getRarezaClass(personaje.rareza);
            const isSelected = this.equipoSeleccionado.includes(personaje.uid);
            const selectedClass = isSelected ? 'selected' : '';

            // Solo mostrar imagen, click para detalles o seleccionar equipo
            let cardHTML = `
                <div class="character-thumb ${rarezaClass} ${selectedClass}" 
                     data-uid="${personaje.uid}" 
                     data-index="${index}"
                     onclick="cw.togglePersonajeEquipo('${personaje.uid}')"
                     oncontextmenu="cw.mostrarDetallePersonaje('${personaje.uid}'); return false;"
                     title="Click: Añadir al equipo | Click derecho: Ver detalles">
                    <img src="${personaje.img}" class="thumb-image" 
                         onerror="this.src='/cliente/img/cofre.png'" alt="${personaje.nombre}">
                    <div class="thumb-rarity ${rarezaClass}">${personaje.rareza}</div>
                    ${personaje.copias > 0 ? `<span class="thumb-copies">+${personaje.copias}</span>` : ''}
                    ${isSelected ? '<div class="thumb-check">✓</div>' : ''}
                </div>
            `;
            grid.append(cardHTML);
        });
        
        // Añadir botón para ver galería completa
        grid.append(`
            <div class="text-center w-100 mt-3">
                <button class="btn-gallery-open" onclick="cw.mostrarInventarioCompleto()">
                    🏆 Ver Galería de Héroes
                </button>
            </div>
        `);
    };

    // Mostrar detalles de un personaje en modal
    this.mostrarDetallePersonaje = function(uid) {
        const personaje = this.inventarioCompleto.find(p => p.uid === uid);
        if (!personaje) return;
        
        // Store current detail UID so WS updates can target it
        this.currentDetalleUID = personaje.uid;
        this.mostrarVistaDetallePersonaje(personaje);
    };

    // Vista detallada estilo Gacha premium
    this.mostrarVistaDetallePersonaje = function(personaje) {
        // Validar que el personaje existe
        if (!personaje || !personaje.rareza) {
            console.error("Personaje no encontrado o inválido");
            return;
        }
        
        // Asegurar valores por defecto para campos que pueden faltar
        // El servidor usa rangoBase, pero la UI necesita rango
        personaje.rango = personaje.rango || personaje.rangoBase || 'Estrellas';
        personaje.nivel = personaje.nivel || 1;
        personaje.copias = personaje.copias || 0;
        personaje.stats = personaje.stats || { ataque: 50, defensa: 50 };
        
        const rarezaClass = this.getRarezaClass(personaje.rareza);
        const evolucionInfo = this.getEvolucionInfo(personaje);
        const tipoIcono = this.getTipoIcono(personaje.tipo);
        
        // Ocultar contenido principal y mostrar vista detallada
        let vistaHTML = `
            <div id="vistaDetallePersonaje" class="hero-detail-view">
                <div class="hero-detail-container">
                    <!-- Botón volver -->
                    <button class="btn-back" onclick="cw.cerrarVistaDetalle()">
                        ← Volver
                    </button>
                    
                    <!-- Contenido principal -->
                    <div class="hero-detail-content">
                        <!-- Imagen grande del personaje -->
                        <div class="hero-image-section">
                            <div class="hero-frame ${rarezaClass}">
                                <img src="${personaje.img}" class="hero-full-image" 
                                     onerror="this.src='/cliente/img/cofre.png'" alt="${personaje.nombre}">
                                <div class="hero-rarity-badge ${rarezaClass}">${personaje.rareza}</div>
                            </div>
                            <div class="hero-name-plate">
                                <h2 class="hero-name">${personaje.nombre}</h2>
                                <div class="hero-type">
                                    <span class="type-icon">${tipoIcono}</span>
                                    <span>${personaje.tipo}</span>
                                </div>
                            </div>
                        </div>
                        
                        <!-- Panel de stats -->
                        <div class="hero-stats-panel">
                            <div class="stats-header">
                                <h3>📊 Estadísticas</h3>
                            </div>
                            
                            <div class="stat-row">
                                <div class="stat-icon">❤️</div>
                                <div class="stat-label">HP</div>
                                <div class="stat-bar-container">
                                    <div class="stat-bar hp-bar" style="width: ${Math.min(personaje.stats.vida / 3.5, 100)}%"></div>
                                </div>
                                <div class="stat-value">${personaje.stats.vida}</div>
                            </div>
                            
                            <div class="stat-row">
                                <div class="stat-icon">⚔️</div>
                                <div class="stat-label">ATK</div>
                                <div class="stat-bar-container">
                                    <div class="stat-bar atk-bar" style="width: ${Math.min(personaje.stats.ataque / 1.5, 100)}%"></div>
                                </div>
                                <div class="stat-value">${personaje.stats.ataque}</div>
                            </div>
                            
                            <div class="stat-row">
                                <div class="stat-icon">🛡️</div>
                                <div class="stat-label">DEF</div>
                                <div class="stat-bar-container">
                                    <div class="stat-bar def-bar" style="width: ${Math.min(personaje.stats.defensa / 1.2, 100)}%"></div>
                                </div>
                                <div class="stat-value">${personaje.stats.defensa}</div>
                            </div>
                            
                            <!-- Información de evolución -->
                            <div class="evolution-section">
                                <h4>⭐ Evolución</h4>
                                <div class="evolution-info">
                                    <div class="evolution-rank">
                                        <span class="rank-label">Rango:</span>
                                        <span class="rank-value rank-${(personaje.rangoBase || personaje.rango || 'Estrellas').toLowerCase()}">${this.getRangoTexto(personaje)}</span>
                                    </div>
                                    <div class="evolution-level">
                                        <span class="level-label">Nivel:</span>
                                        <span class="level-value">${personaje.nivel}</span>
                                    </div>
                                    <div class="evolution-copies">
                                        <span class="copies-label">Copias:</span>
                                        <span class="copies-value">${personaje.copias}</span>
                                    </div>
                                </div>
                                <div class="evolution-progress">
                                    ${evolucionInfo}
                                </div>

                                <!-- XP Progress -->
                                <div class="detalle-xp-section">
                                    <h5>Experiencia</h5>
                                    <div class="detalle-xp-bar-container">
                                        <div id="detalle-xp-bar" class="detalle-xp-bar" style="width: 0%"></div>
                                        <span id="detalle-xp-text" class="detalle-xp-text">0/0</span>
                                    </div>
                                    <div class="detalle-xp-meta">
                                        Nivel: <span id="detalle-nivel" class="level-value">${personaje.nivel}</span>
                                    </div>
                                </div>
                                
                                <!-- === PASIVA Y ULTIMATE v2.0 === -->
                                <div class="abilities-section">
                                    <h4>⚡ Habilidades</h4>
                                    
                                    <!-- Pasiva -->
                                    <div class="ability-card pasiva">
                                        <div class="ability-header">
                                            <span class="ability-icon">🛡️</span>
                                            <span class="ability-label">PASIVA</span>
                                        </div>
                                        <div class="ability-description">
                                            ${personaje.pasiva || 'Sin pasiva especial'}
                                        </div>
                                    </div>
                                    
                                    <!-- Ultimate -->
                                    <div class="ability-card ultimate ${personaje.ultimate ? '' : 'no-ultimate'}">
                                        <div class="ability-header">
                                            <span class="ability-icon">🌟</span>
                                            <span class="ability-label">ULTIMATE</span>
                                            ${personaje.ultimate ? `<span class="ability-cost">⚡ ${personaje.ultimate.coste || 4} Maná</span>` : ''}
                                        </div>
                                        <div class="ability-name">
                                            ${personaje.ultimate ? personaje.ultimate.nombre : 'Sin ultimate'}
                                        </div>
                                        <div class="ability-description">
                                            ${personaje.ultimate ? personaje.ultimate.desc : 'Este personaje no posee una ultimate especial.'}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            <!-- Botones de acción -->
                            <div class="hero-actions">
                                ${this.getBotonEvolucion(personaje)}
                                <div class="xp-buttons">
                                    <button class="btn-xp-test-detail" onclick="ws.testAplicarXP('${personaje.uid}', 100);">+100 XP</button>
                                    <button class="btn-xp-test-detail btn-xp-big" onclick="ws.testAplicarXP('${personaje.uid}', 500000000);">+500M XP</button>
                                    <button class="btn-xp-test-detail btn-xp-big btn-xp-eterno" onclick="ws.testAplicarXP('${personaje.uid}', 500000000000000);">+500T XP</button>
                                </div>
                                <button class="btn-add-team ${this.equipoSeleccionado.includes(personaje.uid) ? 'in-team' : ''}" 
                                        onclick="cw.togglePersonajeEquipo('${personaje.uid}'); cw.cerrarVistaDetalle();">
                                    ${this.equipoSeleccionado.includes(personaje.uid) ? '✓ En el equipo' : '+ Añadir al equipo'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        $('body').append(vistaHTML);
        setTimeout(() => $('#vistaDetallePersonaje').addClass('active'), 10);
    };

    this.getTipoIcono = function(tipo) {
        const iconos = {
            'Fuego': '🔥',
            'Agua': '💧',
            'Tierra': '🪨',
            'Aire': '🌪️',
            'Luz': '✨',
            'Oscuridad': '🌑'
        };
        return iconos[tipo] || '⚡';
    };

    this.cerrarVistaDetalle = function() {
        $('#vistaDetallePersonaje').removeClass('active');
        setTimeout(() => $('#vistaDetallePersonaje').remove(), 300);
        // Clear current detail UID
        this.currentDetalleUID = undefined;
    };

    this.cerrarGaleria = function() {
        $('#galeriaPersonajes').removeClass('active');
        setTimeout(() => $('#galeriaPersonajes').remove(), 300);
    };

    this.getRarezaBadgeColor = function(rareza) {
        switch(rareza) {
            case 'UR': return 'warning';
            case 'SSR': return 'primary';
            case 'Raro': return 'success';
            default: return 'secondary';
        }
    };

    // Obtiene el icono del rango
    this.getIconoRango = function(rangoBase) {
        const iconos = {
            'Estrellas': '⭐',
            'Lunas': '🌙',
            'Flores': '🌸',
            'Soles': '☀️',
            'Coronas': '👑',
            'Dragones': '🐉',
            'Dioses': '⚡',
            'Infinito': '♾️',
            'ETERNO': '🜂'
        };
        return iconos[rangoBase] || '⭐';
    };
    
    // Obtiene el texto completo del rango (ej: "🌙 Lunas 3")
    this.getRangoTexto = function(personaje) {
        const rangoBase = personaje.rangoBase || personaje.rango || 'Estrellas';
        const nivelRango = personaje.nivelRango || 1;
        const icono = this.getIconoRango(rangoBase);
        return `${icono} ${rangoBase} ${nivelRango}`;
    };

    this.getEvolucionInfo = function(personaje) {
        // Nuevo sistema con 6 niveles por rango
        const rangoBase = personaje.rangoBase || personaje.rango || 'Estrellas';
        const nivelRango = personaje.nivelRango || 1;
        const icono = this.getIconoRango(rangoBase);
        
        // Verificar si está en máximo
        if (personaje.esMaximo) {
            return `<div class="evolution-max">${icono} ¡Rango máximo para ${personaje.rareza}!</div>`;
        }
        
        const rangos = ['Estrellas', 'Lunas', 'Flores', 'Soles', 'Coronas', 'Dragones', 'Dioses', 'Infinito', 'ETERNO'];
        const indiceRango = rangos.indexOf(rangoBase);
        const limiteRango = personaje.limiteRango !== undefined ? personaje.limiteRango : rangos.length - 1;
        const esZenith = personaje.nombre === 'ZENITH';
        
        // Determinar siguiente evolución
        let siguienteTexto = "";
        let copiasRequeridas = 0;
        
        if (nivelRango < 6) {
            // Subir nivel dentro del rango
            copiasRequeridas = 1;
            siguienteTexto = `${icono} ${rangoBase} ${nivelRango + 1}`;
        } else if (indiceRango < rangos.length - 1 && indiceRango < limiteRango) {
            // Cambiar de rango
            copiasRequeridas = 2;
            const siguienteRango = rangos[indiceRango + 1];
            const siguienteIcono = this.getIconoRango(siguienteRango);
            siguienteTexto = `${siguienteIcono} ${siguienteRango} 1`;
            if (esZenith && siguienteRango === 'ETERNO') {
                copiasRequeridas = 1;
            }
        }
        
        if (copiasRequeridas && personaje.copias >= copiasRequeridas) {
            return `<div class="evolution-ready gold">✨ ¡Puede evolucionar a ${siguienteTexto}!</div>`;
        }
        
        if (copiasRequeridas) {
            const copiasRestantes = copiasRequeridas - personaje.copias;
            return `<div class="evolution-progress-text">Necesitas ${copiasRestantes} copia${copiasRestantes > 1 ? 's' : ''} para ${siguienteTexto}</div>`;
        }

        return '';
    };

    // Genera el botón de evolución si el personaje puede evolucionar
    this.getBotonEvolucion = function(personaje) {
        // Nuevo sistema con 6 niveles por rango
        const rangoBase = personaje.rangoBase || personaje.rango || 'Estrellas';
        const nivelRango = personaje.nivelRango || 1;
        
        // Verificar si está en máximo
        if (personaje.esMaximo) {
            const icono = this.getIconoRango(rangoBase);
            return `<button class="btn-evolve max" disabled>${icono} Rango Máximo (${personaje.rareza})</button>`;
        }
        
        const rangos = ['Estrellas', 'Lunas', 'Flores', 'Soles', 'Coronas', 'Dragones', 'Dioses', 'Infinito', 'ETERNO'];
        const indiceRango = rangos.indexOf(rangoBase);
        const limiteRango = personaje.limiteRango !== undefined ? personaje.limiteRango : rangos.length - 1;
        const esZenith = personaje.nombre === 'ZENITH';
        
        // Determinar siguiente evolución
        let siguienteTexto = "";
        let copiasRequeridas = 0;
        
        if (nivelRango < 6) {
            // Subir nivel dentro del rango
            copiasRequeridas = 1;
            const icono = this.getIconoRango(rangoBase);
            siguienteTexto = `${icono} ${rangoBase} ${nivelRango + 1}`;
        } else if (indiceRango < rangos.length - 1 && indiceRango < limiteRango) {
            // Cambiar de rango
            copiasRequeridas = 2;
            const siguienteRango = rangos[indiceRango + 1];
            const siguienteIcono = this.getIconoRango(siguienteRango);
            siguienteTexto = `${siguienteIcono} ${siguienteRango} 1`;
            if (esZenith && siguienteRango === 'ETERNO') {
                copiasRequeridas = 1;
            }
        } else {
            const icono = this.getIconoRango(rangoBase);
            return `<button class="btn-evolve max" disabled>${icono} Rango Máximo</button>`;
        }
        
        const puedeEvolucionar = personaje.copias >= copiasRequeridas;
        
        if (puedeEvolucionar) {
            return `<button class="btn-evolve" onclick="cw.evolucionarPersonaje('${personaje.uid}')">
                        ⬆️ Evolucionar a ${siguienteTexto}
                    </button>`;
        }
        
        const copiasRestantes = copiasRequeridas - personaje.copias;
        return `<button class="btn-evolve" disabled>
                    🔒 Necesitas ${copiasRestantes} copia${copiasRestantes > 1 ? 's' : ''} más
                </button>`;
    };

    // Evoluciona un personaje
    this.evolucionarPersonaje = function(uid) {
        rest.evolucionarPersonaje(uid, (resultado) => {
            if (resultado.exito) {
                this.mostrarEvolucionExitosa(resultado);
            } else {
                this.mostrarModal(`⚠️ ${resultado.mensaje}`);
            }
        });
    };

    // Muestra una animación/pantalla de evolución exitosa con comparación de stats
    this.mostrarEvolucionExitosa = function(resultado) {
        const inst = resultado.instancia;
        const mejoras = resultado.mejoras;
        const statsAnt = resultado.statsAnteriores;
        
        // Buscar el personaje en inventarioCompleto para obtener nombre/img
        let personaje = this.inventarioCompleto ? 
            this.inventarioCompleto.find(p => p.uid === inst.uid) : null;
        let nombre = personaje ? personaje.nombre : 'Tu héroe';
        let img = personaje ? personaje.img : '/cliente/img/default.png';
        
        // Calcular poder anterior y nuevo
        const poderAnterior = mejoras.poder ? (inst.poder - mejoras.poder) : 0;
        const poderNuevo = inst.poder || 0;
        const mejoraPoder = mejoras.poder || 0;
        
        // Obtener el rango nuevo con formato
        const rangoNuevo = resultado.rangoNuevo || `${resultado.iconoNuevo} ${inst.rangoBase || inst.rango} ${inst.nivelRango || ''}`;
        
        let html = `
            <div class="evolution-result text-center">
                <div class="evolution-header">
                    <h2 class="text-warning mb-3">✨ ¡EVOLUCIÓN EXITOSA! ✨</h2>
                </div>
                
                <div class="evolution-character mb-4">
                    <img src="${img}" alt="${nombre}" 
                         style="width: 120px; height: 120px; object-fit: cover; border-radius: 50%; 
                                border: 3px solid #D4AF37; animation: evolve-glow 1s ease-in-out infinite alternate;">
                    <h3 class="text-white mt-2">${nombre}</h3>
                </div>
                
                <div class="evolution-rank-change mb-4" style="font-size: 1.3rem;">
                    <span style="color: #888;">${resultado.rangoAnterior}</span>
                    <span class="mx-3" style="color: #D4AF37;">→</span>
                    <span style="color: #FFD700; text-shadow: 0 0 10px #D4AF37;">${rangoNuevo}</span>
                </div>
                
                <div class="evolution-stats" style="background: rgba(0,0,0,0.5); border-radius: 10px; padding: 15px; border: 1px solid #D4AF37;">
                    <h4 class="text-warning mb-3">📊 Mejora de Estadísticas</h4>
                    
                    <div class="stat-comparison" style="display: grid; grid-template-columns: 1fr; gap: 10px;">
                        <div class="stat-row" style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="color: #ff6b6b;">⚔️ Ataque</span>
                            <span>
                                <span style="color: #888;">${statsAnt.ataque}</span>
                                <span style="color: #D4AF37; margin: 0 10px;">→</span>
                                <span style="color: #fff; font-weight: bold;">${inst.stats.ataque}</span>
                                <span style="color: #4ade80; margin-left: 10px;">(+${mejoras.ataque})</span>
                            </span>
                        </div>
                        
                        <div class="stat-row" style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="color: #4dabf7;">🛡️ Defensa</span>
                            <span>
                                <span style="color: #888;">${statsAnt.defensa}</span>
                                <span style="color: #D4AF37; margin: 0 10px;">→</span>
                                <span style="color: #fff; font-weight: bold;">${inst.stats.defensa}</span>
                                <span style="color: #4ade80; margin-left: 10px;">(+${mejoras.defensa})</span>
                            </span>
                        </div>
                        
                        <div class="stat-row" style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="color: #69db7c;">❤️ Vida</span>
                            <span>
                                <span style="color: #888;">${statsAnt.vida}</span>
                                <span style="color: #D4AF37; margin: 0 10px;">→</span>
                                <span style="color: #fff; font-weight: bold;">${inst.stats.vida}</span>
                                <span style="color: #4ade80; margin-left: 10px;">(+${mejoras.vida})</span>
                            </span>
                        </div>
                        
                        <hr style="border-color: #D4AF37; margin: 10px 0;">
                        
                        <div class="stat-row" style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="color: #ff00ff; font-weight: bold;">⚡ PODER</span>
                            <span>
                                <span style="color: #888;">${poderAnterior.toLocaleString()}</span>
                                <span style="color: #D4AF37; margin: 0 10px;">→</span>
                                <span style="color: #FFD700; font-weight: bold; font-size: 1.2rem;">${poderNuevo.toLocaleString()}</span>
                                <span style="color: #4ade80; margin-left: 10px;">(+${mejoraPoder})</span>
                            </span>
                        </div>
                    </div>
                </div>
                
                <div class="mt-3 text-muted">
                    Copias restantes: ${inst.copias}
                </div>
            </div>
            
            <style>
                @keyframes evolve-glow {
                    from { box-shadow: 0 0 10px #D4AF37, 0 0 20px #D4AF37; }
                    to { box-shadow: 0 0 20px #FFD700, 0 0 40px #FFD700; }
                }
            </style>
        `;
        
        this.mostrarModal(html);
        
        // Cerrar vista detalle y actualizar inventario
        this.cerrarVistaDetalle();
        rest.obtenerInventario();
    };

    // Confirmar antes de mejorar todos los personajes
    this.confirmarMejorarTodos = function() {
        // Contar personajes que pueden evolucionar
        let puedenEvolucionar = 0;
        if (this.inventarioCompleto) {
            puedenEvolucionar = this.inventarioCompleto.filter(p => p.copias > 0 && !p.esMaximo).length;
        }
        
        if (puedenEvolucionar === 0) {
            this.mostrarModal("ℹ️ No hay personajes que puedan evolucionar. Necesitas obtener más copias.");
            return;
        }
        
        let html = `
            <div class="confirm-upgrade-all text-center">
                <h2 class="text-warning mb-3">⬆️ Mejorar Todos al Máximo</h2>
                <p class="text-white mb-4">
                    Se evolucionarán automáticamente <strong>${puedenEvolucionar}</strong> personajes 
                    hasta su rango máximo posible utilizando las copias disponibles.
                </p>
                <div class="alert alert-info" style="background: rgba(0,100,255,0.2); border: 1px solid #4dabf7; border-radius: 10px; padding: 15px;">
                    <strong>ℹ️ Esta acción:</strong>
                    <ul style="text-align: left; margin-top: 10px;">
                        <li>Gastará las copias de cada personaje</li>
                        <li>Subirá el rango hasta donde las copias permitan</li>
                        <li>Aumentará el poder de tus personajes</li>
                    </ul>
                </div>
                <div class="mt-4">
                    <button class="btn btn-success btn-lg me-2" onclick="cw.ejecutarMejorarTodos()">
                        ✅ Confirmar
                    </button>
                    <button class="btn btn-secondary btn-lg" onclick="cw.cerrarModalPersonalizado()">
                        ❌ Cancelar
                    </button>
                </div>
            </div>
        `;
        
        this.mostrarModal(html);
    };
    
    // Ejecutar la mejora de todos los personajes
    this.ejecutarMejorarTodos = function() {
        // Cerrar modal de confirmación
        this.cerrarModalPersonalizado();
        
        // Mostrar loading
        this.mostrarModal(`
            <div class="text-center">
                <div class="spinner-border text-warning mb-3" role="status" style="width: 3rem; height: 3rem;">
                    <span class="visually-hidden">Mejorando...</span>
                </div>
                <h3 class="text-white">⬆️ Mejorando personajes...</h3>
                <p class="text-muted">Por favor espera mientras se evolucionan tus héroes</p>
            </div>
        `);
        
        // Llamar al servidor
        rest.evolucionarTodosAlMaximo((resultado) => {
            if (resultado.exito) {
                this.mostrarResultadoMejorarTodos(resultado);
                rest.obtenerInventario();
            } else {
                this.mostrarModal(`ℹ️ ${resultado.mensaje}`);
            }
        });
    };
    
    // Mostrar el resultado de mejorar todos los personajes
    this.mostrarResultadoMejorarTodos = function(resultado) {
        let personajesHTML = '';
        
        if (resultado.personajesMejorados && resultado.personajesMejorados.length > 0) {
            personajesHTML = resultado.personajesMejorados.map(p => `
                <div class="upgrade-result-item" style="display: flex; align-items: center; gap: 10px; padding: 8px; background: rgba(0,0,0,0.3); border-radius: 8px; margin-bottom: 5px;">
                    <img src="${p.img}" alt="${p.nombre}" 
                         style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover; border: 2px solid #D4AF37;"
                         onerror="this.src='/cliente/img/cofre.png'">
                    <div style="flex: 1; min-width: 0;">
                        <div style="color: #fff; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${p.nombre}</div>
                        <div style="font-size: 0.8rem;">
                            <span style="color: #888;">${p.rangoInicial}</span>
                            <span style="color: #D4AF37;"> → </span>
                            <span style="color: #FFD700;">${p.rangoFinal}</span>
                        </div>
                    </div>
                    <div style="text-align: right;">
                        <div style="color: #4ade80; font-weight: bold;">+${p.mejoraPoder}</div>
                        <div style="color: #888; font-size: 0.7rem;">PODER</div>
                    </div>
                </div>
            `).join('');
        }
        
        // Calcular mejora total de poder
        const mejoraPoderTotal = resultado.personajesMejorados.reduce((sum, p) => sum + p.mejoraPoder, 0);
        
        let html = `
            <div class="upgrade-all-result text-center">
                <div class="upgrade-header mb-4">
                    <h2 class="text-warning">✨ ¡MEJORA COMPLETADA! ✨</h2>
                    <p class="text-success" style="font-size: 1.2rem;">${resultado.mensaje}</p>
                </div>
                
                <div class="upgrade-summary mb-4" style="display: flex; justify-content: center; gap: 30px;">
                    <div class="summary-stat" style="text-align: center;">
                        <div style="font-size: 2rem; color: #FFD700; font-weight: bold;">${resultado.personajesMejorados.length}</div>
                        <div style="color: #888;">Personajes</div>
                    </div>
                    <div class="summary-stat" style="text-align: center;">
                        <div style="font-size: 2rem; color: #4ade80; font-weight: bold;">${resultado.evolucionesTotales}</div>
                        <div style="color: #888;">Evoluciones</div>
                    </div>
                    <div class="summary-stat" style="text-align: center;">
                        <div style="font-size: 2rem; color: #ff00ff; font-weight: bold;">+${mejoraPoderTotal.toLocaleString()}</div>
                        <div style="color: #888;">Poder Total</div>
                    </div>
                </div>
                
                <div class="upgrade-list" style="max-height: 300px; overflow-y: auto; background: rgba(0,0,0,0.4); border-radius: 10px; padding: 10px; border: 1px solid #D4AF37;">
                    <h4 class="text-warning mb-3">📋 Detalle de Mejoras</h4>
                    ${personajesHTML}
                </div>
                
                <div class="mt-4">
                    <button class="btn btn-primary btn-lg" onclick="cw.cerrarModalPersonalizado()">
                        ¡Genial! 🎉
                    </button>
                </div>
            </div>
            
            <style>
                .upgrade-all-result { animation: fadeInUp 0.5s ease-out; }
                @keyframes fadeInUp {
                    from { opacity: 0; transform: translateY(20px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            </style>
        `;
        
        this.mostrarModal(html);
    };

    // GALERÍA COMPLETA DE HÉROES - ESTILO GACHA
    this.mostrarInventarioCompleto = function() {
        // Crear vista de galería fullscreen
        let galeriaHTML = `
            <div id="galeriaPersonajes" class="hero-gallery-view">
                <div class="hero-gallery-container">
                    <!-- Header de la galería -->
                    <div class="gallery-header">
                        <button class="btn-back" onclick="cw.cerrarGaleria()">
                            ← Volver
                        </button>
                        <h2 class="gallery-title">🏆 Galería de Héroes</h2>
                        <div class="gallery-count">
                            <span class="count-value">${this.inventarioCompleto.length}</span>
                            <span class="count-label">Héroes</span>
                        </div>
                    </div>
                    
                    <!-- Grid de personajes -->
                    <div class="hero-gallery-grid">
                        ${this.inventarioCompleto.map(p => this.crearTarjetaGaleria(p)).join('')}
                    </div>
                </div>
            </div>
        `;
        
        $('body').append(galeriaHTML);
        setTimeout(() => $('#galeriaPersonajes').addClass('active'), 10);
    };

    // Crear tarjeta individual para la galería
    this.crearTarjetaGaleria = function(personaje) {
        const rarezaClass = this.getRarezaClass(personaje.rareza);
        const tipoIcono = this.getTipoIcono(personaje.tipo);
        const enEquipo = this.equipoSeleccionado.includes(personaje.uid);
        
        return `
            <div class="gallery-hero-card ${rarezaClass} ${enEquipo ? 'in-team' : ''}" 
                 onclick="cw.mostrarVistaDetallePersonaje(cw.inventarioCompleto.find(p => p.uid === '${personaje.uid}'))">
                <div class="card-glow"></div>
                <div class="card-image-wrapper">
                    <img src="${personaje.img}" class="card-hero-image" 
                         onerror="this.src='/cliente/img/cofre.png'" alt="${personaje.nombre}">
                </div>
                <div class="card-overlay">
                    <div class="card-type-badge">${tipoIcono}</div>
                    <div class="card-rarity-badge ${rarezaClass}">${personaje.rareza}</div>
                    ${enEquipo ? '<div class="card-team-badge">⭐ EQUIPO</div>' : ''}
                </div>
                <div class="card-info">
                    <div class="card-name">${personaje.nombre}</div>
                    <div class="card-level">Nv. ${personaje.nivel}</div>
                </div>
            </div>
        `;
    };

    this.togglePersonajeEquipo = function(uid) {
        const index = this.equipoSeleccionado.indexOf(uid);
        
        if (index > -1) {
            // Quitar del equipo
            this.equipoSeleccionado.splice(index, 1);
        } else if (this.equipoSeleccionado.length < 3) {
            // Añadir al equipo
            this.equipoSeleccionado.push(uid);
        } else {
            this.mostrarModal("⚠️ El equipo ya tiene 3 personajes");
            return;
        }

        this.actualizarUIEquipo();
    };

    this.actualizarUIEquipo = function() {
        // Actualizar slots
        for (let i = 0; i < 3; i++) {
            const slot = $(`#slot-${i}`);
            slot.empty();
            
            if (this.equipoSeleccionado[i]) {
                const personaje = this.inventarioCompleto.find(p => p.uid === this.equipoSeleccionado[i]);
                if (personaje) {
                    slot.addClass('filled').html(`
                        <img src="${personaje.img}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 10px;"
                             onerror="this.src='/cliente/img/cofre.png'">
                    `);
                }
            } else {
                slot.removeClass('filled').html(`<span class="slot-number">${i+1}</span>+`);
            }
        }

        // Actualizar cartas del inventario
        $('.character-card').removeClass('selected');
        this.equipoSeleccionado.forEach(uid => {
            $(`.character-card[data-uid="${uid}"]`).addClass('selected');
        });

        // Habilitar/deshabilitar botones
        const equipoCompleto = this.equipoSeleccionado.length === 3;
        $('#btnCrearPartida').prop('disabled', !equipoCompleto);
        $('[id^=btnUnir]').prop('disabled', !equipoCompleto);
    };

    this.limpiarEquipo = function() {
        this.equipoSeleccionado = [];
        this.actualizarUIEquipo();
    };
    // ==================== GESTIÓN DE PARTIDAS ====================
    this.mostrarCrearPartida = function() {
        let cadena = `
            <button id="btnCrearPartida" class="btn-aurora btn-block">
                ⚔️ Crear Partida 3v3
            </button>
        `;
        $("#divCrearPartida").html(cadena);
        $("#btnCrearPartida").on("click", () => {
            this.mostrarPantallaSeleccionEquipo('crear');
        });
    };

    // Pantalla de selección de equipo (aparece al dar click en crear/unirse)
    this.mostrarPantallaSeleccionEquipo = function(modo, codigoPartida = null) {
        // Limpiar selección previa
        this.equipoSeleccionado = [];
        
        const esUnirse = modo === 'unirse';
        const titulo = esUnirse ? 'Selecciona tu Equipo para Unirte' : 'Selecciona tu Equipo para Crear Partida';
        
        const overlayHTML = `
            <div id="seleccionEquipoOverlay" class="seleccion-equipo-overlay fade-in">
                <div class="seleccion-equipo-container glass-card">
                    <h2 class="text-gradient mb-3">${titulo}</h2>
                    <p class="text-secondary">Elige 3 campeones para la batalla</p>
                    
                    <!-- Slots de equipo -->
                    <div class="team-selection-preview mb-4" id="teamSlotsPreview">
                        <div class="team-slot-preview" id="slotPreview-0"><span class="slot-number">I</span>+</div>
                        <div class="team-slot-preview" id="slotPreview-1"><span class="slot-number">II</span>+</div>
                        <div class="team-slot-preview" id="slotPreview-2"><span class="slot-number">III</span>+</div>
                    </div>
                    
                    <!-- Grid de personajes disponibles -->
                    <div class="seleccion-grid" id="seleccionEquipoGrid"></div>
                    
                    <!-- Botones de acción -->
                    <div class="mt-4 d-flex justify-content-center" style="gap: 15px;">
                        <button class="btn-stone" id="btnCancelarSeleccion">❌ Cancelar</button>
                        <button class="btn-aurora" id="btnConfirmarEquipo" disabled>
                            ${esUnirse ? '🎮 Unirse a Partida' : '⚔️ Confirmar y Crear'}
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        $('body').append(overlayHTML);
        
        // Poblar grid con personajes
        this.poblarGridSeleccionEquipo();
        
        // Evento cancelar
        $('#btnCancelarSeleccion').on('click', () => {
            this.cerrarPantallaSeleccionEquipo();
        });
        
        // Evento confirmar
        $('#btnConfirmarEquipo').on('click', () => {
            if (this.equipoSeleccionado.length === 3) {
                if (esUnirse && codigoPartida) {
                    ws.unirAPartida(codigoPartida, this.equipoSeleccionado);
                } else {
                    ws.crearPartida(this.equipoSeleccionado);
                }
                this.cerrarPantallaSeleccionEquipo();
            }
        });
    };

    this.poblarGridSeleccionEquipo = function() {
        const grid = $('#seleccionEquipoGrid');
        grid.empty();
        
        if (this.inventarioCompleto.length === 0) {
            grid.html('<div class="text-center text-secondary py-4">No tienes personajes. ¡Invoca alguno primero!</div>');
            return;
        }
        
        this.inventarioCompleto.forEach((personaje) => {
            const rarezaClass = this.getRarezaClass(personaje.rareza);
            
            grid.append(`
                <div class="character-thumb-seleccion ${rarezaClass}" 
                     data-uid="${personaje.uid}"
                     onclick="cw.togglePersonajeSeleccion('${personaje.uid}')">
                    <img src="${personaje.img}" class="thumb-image" 
                         onerror="this.src='/cliente/img/cofre.png'" alt="${personaje.nombre}">
                    <div class="thumb-rarity ${rarezaClass}">${personaje.rareza}</div>
                    <div class="thumb-name">${personaje.nombre}</div>
                    <div class="thumb-check-overlay">✓</div>
                </div>
            `);
        });
    };

    this.togglePersonajeSeleccion = function(uid) {
        const index = this.equipoSeleccionado.indexOf(uid);
        
        if (index > -1) {
            this.equipoSeleccionado.splice(index, 1);
        } else if (this.equipoSeleccionado.length < 3) {
            this.equipoSeleccionado.push(uid);
        } else {
            return; // Ya hay 3 seleccionados
        }
        
        this.actualizarUISeleccionEquipo();
    };

    this.actualizarUISeleccionEquipo = function() {
        // Actualizar slots preview
        for (let i = 0; i < 3; i++) {
            const slot = $(`#slotPreview-${i}`);
            slot.empty();
            
            if (this.equipoSeleccionado[i]) {
                const personaje = this.inventarioCompleto.find(p => p.uid === this.equipoSeleccionado[i]);
                if (personaje) {
                    slot.addClass('filled').html(`
                        <img src="${personaje.img}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 10px;"
                             onerror="this.src='/cliente/img/cofre.png'">
                    `);
                }
            } else {
                slot.removeClass('filled').html(`<span class="slot-number">${['I','II','III'][i]}</span>+`);
            }
        }
        
        // Marcar personajes seleccionados en el grid
        $('.character-thumb-seleccion').removeClass('selected');
        this.equipoSeleccionado.forEach(uid => {
            $(`.character-thumb-seleccion[data-uid="${uid}"]`).addClass('selected');
        });
        
        // Habilitar/deshabilitar botón confirmar
        const equipoCompleto = this.equipoSeleccionado.length === 3;
        $('#btnConfirmarEquipo').prop('disabled', !equipoCompleto);
    };

    this.cerrarPantallaSeleccionEquipo = function() {
        $('#seleccionEquipoOverlay').fadeOut(200, function() {
            $(this).remove();
        });
    };

    this.mostrarListaPartidas = function(lista) {
        let container = $('#divListaPartidas');
        container.empty();

        if (lista.length === 0) {
            container.html('<p class="text-secondary">No hay partidas disponibles</p>');
            return;
        }

        let cadena = '<ul class="list-group" style="background: transparent;">';
        lista.forEach(partida => {
            const esPropia = partida.owner === ws.nick;
            cadena += `
                <li class="list-group-item d-flex justify-content-between align-items-center" 
                    style="background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.1); color: white;">
                    <span>🎮 Partida de <strong>${partida.owner}</strong></span>
                    ${esPropia ? 
                        `<button class="btn btn-outline-danger btn-sm" onclick="ws.eliminarPartida('${partida.codigo}')">Eliminar</button>` :
                        `<button class="btn-zap btn-sm" id="btnUnir${partida.codigo}">Unirse</button>`
                    }
                </li>
            `;
        });
        cadena += '</ul>';
        container.html(cadena);

        // Añadir eventos a botones de unirse
        lista.forEach(partida => {
            if (partida.owner !== ws.nick) {
                $(`#btnUnir${partida.codigo}`).on('click', () => {
                    // Mostrar pantalla de selección de equipo para unirse
                    this.mostrarPantallaSeleccionEquipo('unirse', partida.codigo);
                });
            }
        });
    };

    this.mostrarEsperandoRival = function() {
        // Obtener avatar del jugador desde localStorage
        const avatarLocal = localStorage.getItem('avatar') || '/cliente/img/perfilPorDefecto.png';
        const nickLocal = ws.nick || 'Jugador';
        
        // Ocultar contenido de batalla
        $('#batallaContent').hide();
        
        // Crear pantalla VS espectacular
        const esperaHTML = `
            <div id="esperandoRivalOverlay" class="versus-screen fade-in">
                <div class="versus-container">
                    <!-- Jugador (Izquierda) -->
                    <div class="versus-player left slide-in-left">
                        <div class="versus-avatar-container">
                            <div class="versus-avatar player-glow">
                                <img src="${avatarLocal}" alt="${nickLocal}" 
                                     onerror="this.src='/cliente/img/perfilPorDefecto.png'">
                            </div>
                            <div class="versus-flames left"></div>
                        </div>
                        <div class="versus-nick">${nickLocal}</div>
                        <div class="versus-ready">¡LISTO!</div>
                    </div>
                    
                    <!-- VS Central -->
                    <div class="versus-center">
                        <div class="versus-badge-container">
                            <img src="/cliente/img/versus.png" class="versus-image pulse-vs" 
                                 onerror="this.style.display='none'; this.nextElementSibling.style.display='block';" alt="VS">
                            <div class="versus-text pulse-vs" style="display:none;">VS</div>
                        </div>
                        <div class="versus-code">
                            <span class="code-label">Código:</span>
                            <span class="code-value">${ws.codigo}</span>
                        </div>
                    </div>
                    
                    <!-- Rival (Derecha) - Silueta buscando -->
                    <div class="versus-player right slide-in-right">
                        <div class="versus-avatar-container">
                            <div class="versus-avatar rival-searching">
                                <div class="silhouette-placeholder">
                                    <span class="silhouette-icon">👤</span>
                                </div>
                            </div>
                            <div class="versus-flames right"></div>
                        </div>
                        <div class="versus-nick searching-text">Buscando...</div>
                        <div class="versus-ready searching">
                            <span class="dot-animation">
                                <span>.</span><span>.</span><span>.</span>
                            </span>
                        </div>
                    </div>
                </div>
                
                <!-- Barra de progreso inferior -->
                <div class="versus-bottom">
                    <div class="search-progress">
                        <div class="search-bar">
                            <div class="search-bar-fill"></div>
                        </div>
                        <span class="search-status">Buscando oponente...</span>
                    </div>
                    <button id="btnCancelarPartida" class="btn-surge mt-3">
                        ❌ Cancelar Búsqueda
                    </button>
                </div>
            </div>
        `;
        
        $('#sec-batalla .section-content').append(esperaHTML);
        
        $('#btnCancelarPartida').on('click', () => {
            $('#esperandoRivalOverlay').remove();
            $('#batallaContent').show();
            ws.eliminarPartida(ws.codigo);
        });
    };
    
    // Mostrar rival encontrado antes de iniciar batalla
    this.mostrarRivalEncontrado = function(rivalData, callback) {
        const rivalAvatar = rivalData.avatar || '/cliente/img/perfilPorDefecto.png';
        const rivalNick = rivalData.nick || 'Oponente';
        
        // Actualizar la silueta con los datos del rival
        $('.versus-player.right .versus-avatar').removeClass('rival-searching').addClass('rival-found rival-glow');
        $('.versus-player.right .versus-avatar').html(`
            <img src="${rivalAvatar}" alt="${rivalNick}" 
                 onerror="this.src='/cliente/img/perfilPorDefecto.png'">
        `);
        $('.versus-player.right .versus-nick').removeClass('searching-text').text(rivalNick);
        $('.versus-player.right .versus-ready').removeClass('searching').html('¡LISTO!');
        
        // Añadir efecto de "encontrado"
        $('.versus-center').addClass('match-found');
        $('.search-status').text('¡Oponente encontrado!');
        $('.search-bar-fill').css('width', '100%');
        
        // Esperar y luego iniciar batalla
        setTimeout(() => {
            if (callback) callback();
        }, 1500);
    };
    
    this.ocultarEsperandoRival = function() {
        $('#esperandoRivalOverlay').remove();
        $('#batallaContent').show();
    };

    // ==================== ARENA DE BATALLA 3v3 ====================
    
    // Datos de los fondos disponibles
    this.fondosBatalla = [
        { tipo: "Fuego", imagen: "/cliente/fondo/fondoFuego.png", color: "#ff4500", icono: "🔥" },
        { tipo: "Agua", imagen: "/cliente/fondo/fondoAgua.png", color: "#00bfff", icono: "💧" },
        { tipo: "Tierra", imagen: "/cliente/fondo/fondoTierra.png", color: "#8b4513", icono: "🪨" },
        { tipo: "Aire", imagen: "/cliente/fondo/fondoAire.png", color: "#87ceeb", icono: "🌪️" },
        { tipo: "Luz", imagen: "/cliente/fondo/fondoLuz.png", color: "#ffd700", icono: "✨" },
        { tipo: "Oscuridad", imagen: "/cliente/fondo/fondoOscuridad.png", color: "#4b0082", icono: "🌑" }
    ];
    
    this.mostrarCombate = function(datos) {
        console.log("Datos de batalla:", datos);
        
        const estadoMesa = datos.estadoMesa;
        const rival = estadoMesa.jugadores.find(j => j.nick !== ws.nick);
        
        // Si existe el overlay de espera, mostrar animación de rival encontrado
        if ($('#esperandoRivalOverlay').length > 0 && rival) {
            this.mostrarRivalEncontrado({
                nick: rival.nick,
                avatar: rival.avatar || '/cliente/img/perfilPorDefecto.png'
            }, () => {
                this.ocultarEsperandoRival();
                this.continuarABatalla(datos, estadoMesa);
            });
        } else {
            this.ocultarEsperandoRival();
            this.continuarABatalla(datos, estadoMesa);
        }
    };
    
    this.continuarABatalla = function(datos, estadoMesa) {
        // Si hay fondo seleccionado, mostrar ruleta primero
        if (estadoMesa.fondo) {
            this.mostrarRuletaFondo(estadoMesa.fondo, () => {
                this.iniciarCombate(datos);
            });
        } else {
            this.iniciarCombate(datos);
        }
    };
    
    // Animación de ruleta estilo "slot machine" horizontal
    this.mostrarRuletaFondo = function(fondoSeleccionado, callback) {
        // Crear array extendido con repeticiones para el giro
        const repeticiones = 8; // Cuántas veces repetir los fondos
        let itemsExtendidos = [];
        for (let r = 0; r < repeticiones; r++) {
            this.fondosBatalla.forEach(f => itemsExtendidos.push({...f}));
        }
        
        // Índice donde caerá el seleccionado (en la última repetición)
        const indiceSeleccionado = this.fondosBatalla.findIndex(f => f.tipo === fondoSeleccionado.tipo);
        const indiceFinal = ((repeticiones - 1) * this.fondosBatalla.length) + indiceSeleccionado;
        const fondo = this.fondosBatalla[indiceSeleccionado];
        
        // Crear overlay de ruleta
        const ruletaHTML = `
            <div id="ruletaFondo" class="ruleta-overlay">
                <div class="ruleta-container">
                    <h2 class="ruleta-title">⚔️ Seleccionando Campo de Batalla ⚔️</h2>
                    
                    <div class="slot-machine-container">
                        <div class="slot-machine-frame">
                            <div class="slot-selector-arrow left">▶</div>
                            <div class="slot-viewport">
                                <div class="slot-strip" id="slotStrip">
                                    ${itemsExtendidos.map((f, i) => `
                                        <div class="slot-item" data-tipo="${f.tipo}" data-index="${i}" style="--item-color: ${f.color};">
                                            <div class="slot-item-bg" style="background-image: url('${f.imagen}')"></div>
                                            <div class="slot-item-content">
                                                <span class="slot-icono">${f.icono}</span>
                                                <span class="slot-nombre">${f.tipo}</span>
                                            </div>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                            <div class="slot-selector-arrow right">◀</div>
                        </div>
                        <div class="slot-glow-line"></div>
                    </div>
                    
                    <div class="ruleta-result" style="display: none;">
                        <h3>🏟️ ¡Campo Seleccionado!</h3>
                        <div class="result-fondo">
                            <span class="result-icono">${fondo.icono}</span>
                            <span class="result-tipo" style="color: ${fondo.color};">${fondo.tipo}</span>
                        </div>
                        <p class="result-info"></p>
                    </div>
                </div>
            </div>
        `;
        
        $('body').append(ruletaHTML);
        
        // Calcular posición final del strip para centrar exactamente el item ganador
        // Cada item tiene 170px de ancho + 10px de gap = 180px total
        // El padding-left del strip (215px) ya centra el primer item (índice 0)
        // Para mover al item N, simplemente desplazamos N * 180px
        const itemWidth = 170;
        const gap = 10;
        const itemTotalWidth = itemWidth + gap;
        
        // El offset es simplemente cuántos items hay que pasar
        const offsetFinal = indiceFinal * itemTotalWidth;
        
        // Iniciar animación después de un pequeño delay
        setTimeout(() => {
            const strip = $('#slotStrip');
            
            // Animación con easing de desaceleración
            strip.css({
                'transition': 'transform 4s cubic-bezier(0.15, 0.85, 0.25, 1)',
                'transform': `translateX(-${offsetFinal}px)`
            });
            
            // Añadir efecto de sonido visual (flash en items al pasar)
            let flashInterval = setInterval(() => {
                $('.slot-item').each(function() {
                    if (Math.random() > 0.7) {
                        $(this).addClass('passing');
                        setTimeout(() => $(this).removeClass('passing'), 100);
                    }
                });
            }, 100);
            
            // Parar el flash antes de terminar
            setTimeout(() => clearInterval(flashInterval), 3500);
            
            // Mostrar resultado después de la animación
            setTimeout(() => {
                // Resaltar el item seleccionado (el que tiene el índice correcto)
                $(`.slot-item[data-index="${indiceFinal}"]`).addClass('selected-winner');
                
                // Efecto de celebración
                $('.slot-machine-frame').addClass('winner-glow');
                
                setTimeout(() => {
                    $('.ruleta-result').show();
                    
                    // Información del efecto
                    let infoText = `🔺 Personajes ${fondo.tipo}: +15% estadísticas\n`;
                    infoText += `🔻 Personajes débiles: -15% estadísticas`;
                    $('.result-info').html(infoText.replace('\n', '<br>'));
                    
                    // Cerrar ruleta y continuar
                    setTimeout(() => {
                        $('#ruletaFondo').fadeOut(500, function() {
                            $(this).remove();
                            // Si había un inicio de temporizador pendiente (se recibió estado mientras la ruleta estaba abierta), inícialo ahora
                            try {
                                if (cw && cw._pendingTurnTimer) {
                                    const p = cw._pendingTurnTimer;
                                    delete cw._pendingTurnTimer;
                                    cw.startTurnTimerUI(p.totalSeconds, p.turnoInicioMs);
                                }
                            } catch(e) { /* ignore */ }
                            callback();
                        });
                    }, 2000);
                }, 500);
            }, 4000);
        }, 500);
    };
    
    this.iniciarCombate = function(datos) {
        console.log("Iniciando combate con datos:", datos);
        
        // Validar datos
        if (!datos || !datos.estadoMesa) {
            console.error("Error: datos de combate inválidos", datos);
            this.mostrarModal("Error al iniciar la batalla. Datos inválidos.");
            return;
        }
        
        // Ocultar todas las secciones SPA y navbar
        $('.spa-section').removeClass('active');
        $('#navbarBottom').hide();
        $('#headerTop').hide();
        $('#au').hide();
        $('#battleArena').show();
        
        const estadoMesa = datos.estadoMesa;
        const miJugador = estadoMesa.jugadores.find(j => j.nick === ws.nick);
        const rival = estadoMesa.jugadores.find(j => j.nick !== ws.nick);
        
        // Validar jugadores
        if (!miJugador || !rival) {
            console.error("Error: jugadores no encontrados", { miJugador, rival, jugadores: estadoMesa.jugadores });
            this.mostrarModal("Error: No se encontraron los jugadores en la partida.");
            return;
        }
        
        if (!miJugador.equipo || !rival.equipo) {
            console.error("Error: equipos no encontrados", { miEquipo: miJugador.equipo, rivalEquipo: rival.equipo });
            this.mostrarModal("Error: No se encontraron los equipos de batalla.");
            return;
        }
        
        this.esMiTurno = estadoMesa.turno === ws.nick;
        
        // Iniciar chat de batalla con el código de la partida
        this.iniciarChatBatalla(estadoMesa.codigo);
        
        // Limpiar elementos épicos anteriores
        $('.battle-particles, .arena-border-glow, .campo-indicator').remove();
        
        // Aplicar fondo de batalla épico
        if (estadoMesa.fondo) {
            const fondo = estadoMesa.fondo;
            const fondoInfo = this.fondosBatalla.find(f => f.tipo === fondo.tipo);
            const color = fondoInfo ? fondoInfo.color : '#ffd700';
            const icono = fondoInfo ? fondoInfo.icono : '🏟️';
            
            $('#battleArena').css({
                'background-image': `url('${fondo.imagen}')`,
                'background-size': 'cover',
                'background-position': 'center',
                '--fondo-color': color
            });
            
            // Añadir elementos épicos
            const elementosEpicos = `
                <div class="battle-particles"></div>
                <div class="arena-border-glow"></div>
                <div class="campo-indicator" style="--fondo-color: ${color};">
                    <span class="campo-icono">${icono}</span>
                    <div class="campo-texto">
                        <span class="campo-label">Campo de batalla</span>
                        <span class="campo-tipo" style="color: ${color};">${fondo.tipo}</span>
                    </div>
                </div>
            `;
            $('#battleArena').prepend(elementosEpicos);
        }
        
        // Renderizar equipo del jugador (izquierda)
        this.renderizarEquipo(miJugador.equipo, 'playerTeam', true);
        
        // Renderizar equipo rival (derecha)
        this.renderizarEquipo(rival.equipo, 'enemyTeam', false);
        
        // Actualizar indicador de turno
        this.actualizarIndicadorTurno(estadoMesa.turno);
        // Iniciar la barra de temporizador usando el timestamp servidor (si existe)
        try {
            const inicio = estadoMesa.turnoInicio || Date.now();
            this.startTurnTimerUI(30, inicio);
        } catch (e) { console.error('No se pudo iniciar timer al comenzar la batalla:', e); }
        
        // Configurar botones
        this.configurarBotonesBatalla();
        
        // Log inicial con info del fondo
        let logInicial = '<p class="text-success">¡Que comience la batalla 3v3!</p>';
        if (estadoMesa.fondo) {
            logInicial += `<p class="text-info">🏟️ Campo: ${estadoMesa.fondo.tipo}</p>`;
        }
        $('#battleLog').html(logInicial);
    };

    this.renderizarEquipo = function(equipo, containerId, esJugador) {
        const container = $(`#${containerId}`);
        container.empty();
        
        equipo.forEach((personaje, index) => {
            const porcentajeVida = (personaje.vidaActual / personaje.vida) * 100;
            let healthClass = '';
            if (porcentajeVida <= 20) healthClass = 'critical';
            else if (porcentajeVida <= 50) healthClass = 'low';
            
            const derrotado = personaje.estado === 'derrotado';
            const clases = [];
            
            if (derrotado) clases.push('defeated');
            if (esJugador && this.esMiTurno && !derrotado) clases.push('selectable');
            if (esJugador && this.atacanteSeleccionado === index) clases.push('selected');
            if (!esJugador && this.atacanteSeleccionado !== null && !derrotado) clases.push('targetable');
            
            // Añadir clase de efecto del fondo
            if (personaje.efectoFondo === 'bonificado') clases.push('fondo-buff');
            if (personaje.efectoFondo === 'penalizado') clases.push('fondo-debuff');
            
            const rarezaClass = this.getRarezaClass(personaje.rareza);
            
            // Icono de efecto del fondo
            let efectoIcono = '';
            if (personaje.efectoFondo === 'bonificado') efectoIcono = '<span class="efecto-fondo buff">⬆️</span>';
            else if (personaje.efectoFondo === 'penalizado') efectoIcono = '<span class="efecto-fondo debuff">⬇️</span>';
            
            // === SISTEMA DE ESTADOS v2.0 ===
            let estadosHTML = '';
            if (personaje.estados && personaje.estados.length > 0) {
                const iconosEstados = {
                    'quemado': '🔥',
                    'envenenado': '☠️',
                    'congelado': '❄️',
                    'aturdido': '⚡',
                    'paralizado': '⚡',
                    'dormido': '💤',
                    'cegado': '👁️',
                    'invulnerable': '✨',
                    'anti_curacion': '💔'
                };
                let estadosIconos = personaje.estados.map(e => {
                    const icono = iconosEstados[e.tipo] || '❓';
                    return `<span class="estado-icono estado-${e.tipo}" title="${e.tipo} (${e.duracion} turnos)">${icono}</span>`;
                }).join('');
                estadosHTML = `<div class="estados-container">${estadosIconos}</div>`;
            }
            
            // === SISTEMA DE MANÁ v2.0 ===
            const mana = personaje.mana || 0;
            const manaMax = personaje.manaMax || 4;
            const manaFull = mana >= manaMax;
            let manaSegments = '';
            for (let i = 0; i < manaMax; i++) {
                const filled = i < mana;
                manaSegments += `<div class="mana-segment ${filled ? 'filled' : ''} ${filled && manaFull ? 'max' : ''}"></div>`;
            }
            
            // === SISTEMA DE ESCUDO v2.0 ===
            let escudoHTML = '';
            if (personaje.escudo && personaje.escudo > 0) {
                escudoHTML = `<div class="escudo-indicator" title="Escudo: ${personaje.escudo}">🛡️ ${personaje.escudo}</div>`;
            }
            
            const html = `
                <div class="battle-character ${clases.join(' ')} ${rarezaClass}" 
                     data-index="${index}" 
                     data-team="${esJugador ? 'player' : 'enemy'}"
                     data-mana="${mana}"
                     data-mana-max="${manaMax}"
                     id="${esJugador ? 'player' : 'enemy'}-char-${index}">
                    ${efectoIcono}
                    ${estadosHTML}
                    ${escudoHTML}
                    <img src="${personaje.img}" onerror="this.src='/cliente/img/cofre.png'" alt="${personaje.nombre}">
                    <div class="health-bar-container">
                        <div class="health-bar ${healthClass}" style="width: ${porcentajeVida}%"></div>
                    </div>
                    <div class="mana-bar-container">
                        ${manaSegments}
                    </div>
                    <span class="mana-text ${manaFull ? 'max' : ''}">${mana}/${manaMax}</span>
                    <span class="health-text">${personaje.vidaActual}/${personaje.vida}</span>
                    <div class="char-name">${personaje.nombre}</div>
                </div>
            `;
            container.append(html);
        });
        
        // Eventos de click
        if (esJugador) {
            container.find('.battle-character:not(.defeated)').on('click', (e) => {
                if (this.esMiTurno) {
                    this.seleccionarAtacante($(e.currentTarget).data('index'));
                }
            });
        } else {
            container.find('.battle-character:not(.defeated)').on('click', (e) => {
                if (this.esMiTurno && this.atacanteSeleccionado !== null) {
                    this.seleccionarObjetivo($(e.currentTarget).data('index'));
                }
            });
        }
        
        // === v2.0: Actualizar botones de acción según maná del atacante seleccionado ===
        if (esJugador) {
            this.actualizarBotonesAccion(equipo);
        }
    };

    this.seleccionarAtacante = function(index) {
        this.atacanteSeleccionado = index;
        this.objetivoSeleccionado = null;
        
        // Actualizar UI
        $('#playerTeam .battle-character').removeClass('selected');
        $(`#player-char-${index}`).addClass('selected');
        
        // Activar objetivos
        $('#enemyTeam .battle-character:not(.defeated)').addClass('targetable');
        
        // Habilitar botón defender
        $('#btnDefend').prop('disabled', false);
        $('#btnConfirmAttack').prop('disabled', true);
        
        // === v2.0: Actualizar botón Ultimate según maná ===
        const charElement = $(`#player-char-${index}`);
        const mana = parseInt(charElement.data('mana')) || 0;
        const manaMax = parseInt(charElement.data('mana-max')) || 4;
        
        if (mana >= manaMax) {
            $('#btnUltimate').show().prop('disabled', true); // Habilitar al seleccionar objetivo
        } else {
            $('#btnUltimate').hide();
        }
    };

    // === v2.0: Actualizar botones de acción según maná del equipo ===
    this.actualizarBotonesAccion = function(equipo) {
        // Por defecto ocultar Ultimate
        if (!$('#btnUltimate').length) {
            // Crear botón Ultimate si no existe
            $('#battleActions').find('.battle-actions-row').remove();
            const actionsHTML = `
                <div class="battle-actions-row">
                    <button class="btn-attack" id="btnConfirmAttack" disabled>⚔️ ATACAR</button>
                    <button class="btn-ultimate" id="btnUltimate" disabled style="display:none;">🌟 ULTIMATE</button>
                </div>
                <button class="btn-defend" id="btnDefend" disabled>🛡️ DEFENDER</button>
            `;
            $('#battleActions').html(actionsHTML);
            this.configurarBotonesBatalla();
        }
        
        // Si hay atacante seleccionado, verificar su maná
        if (this.atacanteSeleccionado !== null && equipo[this.atacanteSeleccionado]) {
            const atacante = equipo[this.atacanteSeleccionado];
            const mana = atacante.mana || 0;
            const manaMax = atacante.manaMax || 4;
            
            if (mana >= manaMax && atacante.estado !== 'derrotado') {
                $('#btnUltimate').show();
            } else {
                $('#btnUltimate').hide();
            }
        }
    };

    // Guardar referencia al equipo del jugador para Ultimate
    this.equipoJugadorActual = [];

    this.seleccionarObjetivo = function(index) {
        this.objetivoSeleccionado = index;
        
        // Resaltar objetivo
        $('#enemyTeam .battle-character').removeClass('selected');
        $(`#enemy-char-${index}`).addClass('selected');
        
        // Habilitar botón atacar
        $('#btnConfirmAttack').prop('disabled', false);
        
        // === v2.0: Habilitar Ultimate si el atacante tiene maná completo ===
        const charElement = $(`#player-char-${this.atacanteSeleccionado}`);
        const mana = parseInt(charElement.data('mana')) || 0;
        const manaMax = parseInt(charElement.data('mana-max')) || 4;
        
        if (mana >= manaMax) {
            $('#btnUltimate').prop('disabled', false);
        }
    };

    this.configurarBotonesBatalla = function() {
        $('#btnConfirmAttack').off('click').on('click', () => {
            if (this.atacanteSeleccionado !== null && this.objetivoSeleccionado !== null) {
                ws.realizarAccion(this.atacanteSeleccionado, this.objetivoSeleccionado);
                this.deshabilitarAcciones();
            }
        });
        
        $('#btnDefend').off('click').on('click', () => {
            if (this.atacanteSeleccionado !== null) {
                ws.defender(this.atacanteSeleccionado);
                this.deshabilitarAcciones();
            }
        });
        
        // === v2.0: Botón Ultimate ===
        $('#btnUltimate').off('click').on('click', () => {
            if (this.atacanteSeleccionado !== null && this.objetivoSeleccionado !== null) {
                ws.usarUltimate(this.atacanteSeleccionado, this.objetivoSeleccionado);
                this.deshabilitarAcciones();
            }
        });
        
        $('#btnSurrender').off('click').on('click', () => {
            if (confirm('¿Seguro que quieres rendirte?')) {
                ws.rendirse();
            }
        });
        
        // Estado inicial de botones
        this.actualizarEstadoBotones();
    };

    this.deshabilitarAcciones = function() {
        $('#btnConfirmAttack, #btnDefend').prop('disabled', true);
        this.atacanteSeleccionado = null;
        this.objetivoSeleccionado = null;
    };

    this.actualizarEstadoBotones = function() {
        const habilitado = this.esMiTurno;
        // No habilitar directamente, requiere selección
        $('#btnConfirmAttack').prop('disabled', true);
        $('#btnDefend').prop('disabled', true);
    };

    this.actualizarIndicadorTurno = function(turno) {
        const indicator = $('#turnIndicator');
        this.esMiTurno = turno === ws.nick;
        if (this.esMiTurno) {
            indicator.text('¡TU TURNO!').addClass('my-turn');
        } else {
            indicator.text(`Turno de ${turno}`).removeClass('my-turn');
        }
    };

    // Inicia la barra visual de temporizador en cliente (sincronizada con servidor)
    this._turnTimerRaf = null;
    this._turnTimerStart = null; // ms timestamp
    this._turnTimerDuration = 30000; // ms
    this.startTurnTimerUI = function(totalSeconds, turnoInicioMs) {
        try {
            const duration = (totalSeconds || 30) * 1000;
            this._turnTimerDuration = duration;

            // If ruleta overlay is visible, store a pending start and don't begin yet
            if (document.getElementById('ruletaFondo')) {
                this._pendingTurnTimer = { totalSeconds: totalSeconds || 30, turnoInicioMs: turnoInicioMs };
                return;
            }

            // If server provided turnoInicio, use it; otherwise assume now
            const inicio = turnoInicioMs ? Number(turnoInicioMs) : Date.now();

            // If already running for the same start timestamp, do nothing
            if (this._turnTimerStart && Number(this._turnTimerStart) === Number(inicio) && this._turnTimerRaf) {
                return;
            }

            this._turnTimerStart = inicio;
            const bar = document.getElementById('turnTimerBar');
            const container = document.getElementById('turnTimerContainer');
            if (!bar || !container) return;
            container.style.display = 'block';

            // Ensure any previous RAF is cancelled before starting
            if (this._turnTimerRaf) { cancelAnimationFrame(this._turnTimerRaf); this._turnTimerRaf = null; }

            const tick = () => {
                const now = Date.now();
                const elapsed = now - this._turnTimerStart;
                const pct = Math.max(0, Math.min(1, 1 - (elapsed / this._turnTimerDuration)));
                bar.style.width = (pct * 100) + '%';

                if (pct <= 0) {
                    // Reached zero: cancel RAF and ensure bar shows 0
                    if (this._turnTimerRaf) { cancelAnimationFrame(this._turnTimerRaf); this._turnTimerRaf = null; }
                    bar.style.width = '0%';
                    return;
                }

                this._turnTimerRaf = requestAnimationFrame(tick);
            };

            // Kick off
            this._turnTimerRaf = requestAnimationFrame(tick);
        } catch (e) { console.error('Error iniciando UI timer:', e); }
    };

    this.stopTurnTimerUI = function() {
        try {
            if (this._turnTimerRaf) { cancelAnimationFrame(this._turnTimerRaf); this._turnTimerRaf = null; }
            // Keep the container visible; set bar to 0 for safety
            const bar = document.getElementById('turnTimerBar');
            const container = document.getElementById('turnTimerContainer');
            if (bar) bar.style.width = '0%';
            if (container) container.style.display = 'none';
        } catch(e) { console.error('Error deteniendo UI timer:', e); }
    };

    this.actualizarBatalla = function(datos) {
        console.log("Actualizar batalla:", datos);
        
        const estadoMesa = datos.estadoMesa;
        const miJugador = estadoMesa.jugadores.find(j => j.nick === ws.nick);
        const rival = estadoMesa.jugadores.find(j => j.nick !== ws.nick);
        
        // Añadir al log
        this.agregarLog(datos);
        
        // === v2.0: Mostrar efectos de estado en el log ===
        if (datos.efectosEstados && datos.efectosEstados.length > 0) {
            this.agregarLogEstados(datos.efectosEstados);
        }
        
        // === v2.0: Mostrar efectos de pasivas en el log ===
        if (datos.pasivaAtacanteEfectos && datos.pasivaAtacanteEfectos.length > 0) {
            this.agregarLogPasivas(datos.pasivaAtacanteEfectos);
        }
        if (datos.pasivaDefensorEfectos && datos.pasivaDefensorEfectos.length > 0) {
            this.agregarLogPasivas(datos.pasivaDefensorEfectos);
        }
        
        // Animación de daño si fue ataque
        if (datos.accion === 'atacar') {
            const targetId = datos.defensor.nick === ws.nick ? 
                `#player-char-${datos.defensor.indice}` : 
                `#enemy-char-${datos.defensor.indice}`;
            $(targetId).addClass('damage-flash');
            setTimeout(() => $(targetId).removeClass('damage-flash'), 300);
        }
        
        // Re-renderizar equipos
        this.atacanteSeleccionado = null;
        this.objetivoSeleccionado = null;
        this.esMiTurno = estadoMesa.turno === ws.nick;
        
        // Guardar equipo jugador para referencia en Ultimate
        this.equipoJugadorActual = miJugador.equipo;
        
        this.renderizarEquipo(miJugador.equipo, 'playerTeam', true);
        this.renderizarEquipo(rival.equipo, 'enemyTeam', false);
        
        // Actualizar turno
        if (estadoMesa.turno) {
            this.actualizarIndicadorTurno(estadoMesa.turno);
            // Si el servidor ha incluido el timestamp de inicio del turno, sincronizar la barra
            try {
                if (estadoMesa.turnoInicio) {
                    this.startTurnTimerUI(30, estadoMesa.turnoInicio);
                }
            } catch(e) { console.error('Error sincronizando timer tras acción:', e); }
        }
        
        // Verificar fin de partida
        if (datos.ganador) {
            this.mostrarFinPartida(datos);
        } else {
            this.configurarBotonesBatalla();
        }
    };

    // === v2.0: Añadir efectos de estado al log ===
    this.agregarLogEstados = function(efectos) {
        const log = $('#battleLog');
        efectos.forEach(efecto => {
            let claseEstado = efecto.tipo || '';
            let mensaje = efecto.mensaje || `${efecto.personaje} sufre ${efecto.tipo}`;
            log.append(`<p class="log-entry log-estado ${claseEstado}">${mensaje}</p>`);
        });
        log.scrollTop(log[0].scrollHeight);
    };

    // === v2.0: Añadir efectos de pasivas al log ===
    this.agregarLogPasivas = function(efectos) {
        const log = $('#battleLog');
        efectos.forEach(efecto => {
            if (efecto.mensaje) {
                log.append(`<p class="log-entry log-pasiva">✨ ${efecto.mensaje}</p>`);
            }
        });
        log.scrollTop(log[0].scrollHeight);
    };

    // === v2.0: Procesar resultado de Ultimate ===
    this.procesarUltimate = function(datos) {
        console.log("Ultimate usada:", datos);
        
        const estadoMesa = datos.estadoMesa;
        const miJugador = estadoMesa.jugadores.find(j => j.nick === ws.nick);
        const rival = estadoMesa.jugadores.find(j => j.nick !== ws.nick);
        
        // Añadir al log con estilo especial
        this.agregarLogUltimate(datos);
        
        // === v2.0: Mostrar efectos de estado en el log ===
        if (datos.efectosEstados && datos.efectosEstados.length > 0) {
            this.agregarLogEstados(datos.efectosEstados);
        }
        
        // Animaciones especiales para cada efecto
        if (datos.efectos && datos.efectos.length > 0) {
            datos.efectos.forEach(efecto => {
                if (efecto.indice !== undefined) {
                    const esEnemigo = datos.atacante.nick === ws.nick;
                    const targetId = esEnemigo ? 
                        `#enemy-char-${efecto.indice}` : 
                        `#player-char-${efecto.indice}`;
                    
                    $(targetId).addClass('ultimate-hit');
                    setTimeout(() => $(targetId).removeClass('ultimate-hit'), 800);
                }
            });
        }
        
        // Re-renderizar equipos
        this.atacanteSeleccionado = null;
        this.objetivoSeleccionado = null;
        this.esMiTurno = estadoMesa.turno === ws.nick;
        
        this.equipoJugadorActual = miJugador.equipo;
        
        this.renderizarEquipo(miJugador.equipo, 'playerTeam', true);
        this.renderizarEquipo(rival.equipo, 'enemyTeam', false);
        
        // Actualizar turno
        if (estadoMesa.turno) {
            this.actualizarIndicadorTurno(estadoMesa.turno);
            try {
                if (estadoMesa.turnoInicio) {
                    this.startTurnTimerUI(30, estadoMesa.turnoInicio);
                }
            } catch(e) {}
        }
        
        // Verificar fin de partida
        if (datos.ganador) {
            this.mostrarFinPartida(datos);
        } else {
            this.configurarBotonesBatalla();
        }
    };

    // === v2.0: Log especial para Ultimate ===
    this.agregarLogUltimate = function(datos) {
        const log = $('#battleLog');
        
        let mensaje = `<p class="log-entry log-ultimate">🌟 <strong>${datos.atacante.nombre}</strong> usa <span class="ultimate-name">${datos.nombreUltimate}</span>!</p>`;
        
        // Añadir efectos
        if (datos.efectos && datos.efectos.length > 0) {
            datos.efectos.forEach(efecto => {
                let efectoMsg = '';
                if (efecto.danio !== undefined) {
                    efectoMsg = `→ <strong>${efecto.objetivo}</strong>: <span class="log-damage">-${efecto.danio}</span>`;
                    if (efecto.derrotado) efectoMsg += ' <span class="text-danger">💀 DERROTADO</span>';
                } else if (efecto.curacion !== undefined) {
                    efectoMsg = `→ <strong>${efecto.objetivo}</strong>: <span class="log-heal">+${efecto.curacion} HP</span>`;
                } else if (efecto.escudo !== undefined) {
                    efectoMsg = `→ <strong>${efecto.objetivo}</strong>: <span class="log-shield">+${efecto.escudo} 🛡️</span>`;
                } else if (efecto.mensaje) {
                    efectoMsg = `→ ${efecto.mensaje}`;
                }
                if (efectoMsg) {
                    mensaje += `<p class="log-entry log-effect">${efectoMsg}</p>`;
                }
            });
        }
        
        log.append(mensaje);
        log.scrollTop(log[0].scrollHeight);
    };

    this.agregarLog = function(datos) {
        const log = $('#battleLog');
        let mensaje = '';
        
        if (datos.accion === 'defender') {
            mensaje = `<p class="log-entry">🛡️ <strong>${datos.luchadorNombre}</strong> se pone en guardia</p>`;
        } else if (datos.accion === 'atacar') {
            let extras = '';
            if (datos.esCritico) extras += ' <span class="log-critical">⚡ CRÍTICO</span>';
            if (datos.esBloqueado) extras += ' <span class="text-info">🛡️ BLOQUEADO</span>';
            if (datos.personajeDerrotado) extras += ' <span class="text-danger">💀 DERROTADO</span>';
            
            mensaje = `<p class="log-entry">⚔️ <strong>${datos.atacante.nombre}</strong> → <strong>${datos.defensor.nombre}</strong>: <span class="log-damage">-${datos.danio}</span>${extras}</p>`;
        }
        
        log.append(mensaje);
        log.scrollTop(log[0].scrollHeight);
    };

    this.mostrarFinPartida = function(datos) {
        const esGanador = datos.ganador === ws.nick;
        
        // Limpiar chat de batalla (volátil)
        this.limpiarChatBatalla();
        
        // Detener temporizador de turno
        this.stopTurnTimerUI();
        
        setTimeout(() => {
            // Construir HTML de resultados de XP
            let xpHTML = '';
            if (datos.xpResultados) {
                const misResultados = esGanador ? datos.xpResultados.ganador : datos.xpResultados.perdedor;
                if (misResultados && misResultados.length > 0) {
                    xpHTML = '<div class="xp-results mt-3">';
                    xpHTML += '<h5 class="text-info">📊 Experiencia Ganada</h5>';
                    xpHTML += '<div class="xp-list">';
                    misResultados.forEach(res => {
                        let levelUpBadge = res.subioNivel ? 
                            `<span class="level-up-badge">🎉 ¡LEVEL UP! Nvl ${res.nivelAnterior} → ${res.nivelActual}</span>` : '';
                        xpHTML += `
                            <div class="xp-item ${res.subioNivel ? 'level-up' : ''}">
                                <span class="xp-name">${res.nombre}</span>
                                <span class="xp-gained">+${res.xpGanada} XP</span>
                                ${levelUpBadge}
                                <div class="xp-bar-container">
                                    <div class="xp-bar" style="width: ${(res.xpActual / res.xpNecesaria) * 100}%"></div>
                                    <span class="xp-text">${res.xpActual}/${res.xpNecesaria}</span>
                                </div>
                            </div>
                        `;
                    });
                    xpHTML += '</div></div>';
                }
            }
            
            this.mostrarModal(`
                <div class="text-center">
                    <h2 class="${esGanador ? 'text-success' : 'text-danger'}">
                        ${esGanador ? '🏆 ¡VICTORIA!' : '💀 DERROTA'}
                    </h2>
                    ${datos.recompensa && esGanador ? `<p class="text-warning">+${datos.recompensa} monedas</p>` : ''}
                    ${datos.rendicion ? `<p class="text-muted">${datos.jugadorRendido} se ha rendido</p>` : ''}
                    ${xpHTML}
                </div>
            `);
            
            if (esGanador && datos.recompensa) {
                ws.monedas += datos.recompensa;
                this.actualizarMonedas(ws.monedas);
            }
            
            setTimeout(() => {
                $('#battleArena').hide();
                // Volver a mostrar SPA
                $('#navbarBottom').show();
                $('#headerTop').show();
                this.navegarA('sec-batalla');
                // Refrescar inventario para mostrar nuevos niveles
                rest.obtenerInventario();
            }, 4500);
        }, 1000);
    };

    // ==================== UTILIDADES GENERALES ====================
    this.mostrarModal = function(contenido) {
        $('#mBody').html(contenido);
        $('#miModal').modal('show');
    };

    this.cerrarModalPersonalizado = function() {
        $('#miModal').modal('hide');
    };

    this.mostrarMensajeLogin = function(m) {
        $("#msg").html(`<div class="alert alert-danger">${m}</div>`);
        // Auto-ocultar después de 5 segundos
        setTimeout(function() {
            $("#msg").fadeOut(500, function() {
                $(this).html('').show();
            });
        }, 5000);
    };

    this.limpiar = function() {
        $("#au").empty();
    };

    this.comprobarSesion = function() {
        // Legacy - ahora se usa initSPA
        let nick = $.cookie("nick");
        if (nick) {
            ws.nick = nick;
            ws.email = nick;
            rest.agregarUsuario2(nick, () => {
                this.actualizarMonedas(ws.monedas || 1000);
                this.mostrarAppLogueada();
            });
        }
    };

    this.salir = function() {
        // Mostrar mensaje de despedida
        this.mostrarModal('<div class="text-center py-3"><h3 class="text-gradient">¡Hasta pronto! 👋</h3></div>');
        setTimeout(() => {
            $.removeCookie("nick", { path: '/' });
            $.removeCookie("email", { path: '/' });
            ws.nick = undefined;
            ws.email = undefined;
            ws.avatar = null;
            ws.monedas = 0;
            location.reload();
        }, 1500);
    };


    // ==================== REGISTRO Y LOGIN ====================
    this.mostrarRegistro = function() {
        $("#fmRegistro, #fmLogin").remove();
        let cadena = `
            <div id="fmRegistro" class="glass-card p-4 fade-in" style="max-width: 400px; margin: 0 auto;">
                <h3 class="text-gradient text-center mb-4">📝 Registro</h3>
                <form>
                    <div class="form-group">
                        <label class="text-secondary">Email:</label>
                        <input type="email" class="form-control bg-dark text-white border-secondary" id="email" placeholder="tu@email.com">
                    </div>
                    <div class="form-group">
                        <label class="text-secondary">Contraseña:</label>
                        <input type="password" class="form-control bg-dark text-white border-secondary" id="pwd" placeholder="Mínimo 6 caracteres">
                    </div>
                    <button type="submit" id="btnRegistro" class="btn-aurora btn-block">Registrarse</button>
                    <div class="text-center mt-3">
                        <a href="/auth/google" title="Registrarse con Google">
                            <img src="/cliente/web_light_rd_SI@1x.png" alt="Google" style="height:40px;">
                        </a>
                    </div>
                    <div class="text-center mt-3">
                        <a href="#" id="linkIrLogin" class="text-secondary">¿Ya tienes cuenta? <span class="text-gradient">Inicia sesión</span></a>
                    </div>
                </form>
            </div>
        `;
        $("#registro").html(cadena);
        
        // Link para ir a login
        $("#linkIrLogin").on("click", (e) => {
            e.preventDefault();
            this.mostrarLogin();
        });
        
        const emailInput = $("#email");
        const pwdInput = $("#pwd");
        
        const validarEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
        const marcar = (input, ok) => {
            input.removeClass("is-valid is-invalid").addClass(ok ? "is-valid" : "is-invalid");
        };
        
        $("#btnRegistro").on("click", function(e) {
            e.preventDefault();
            let email = emailInput.val().trim();
            let pwd = pwdInput.val();
            let valido = true;
            
            if (!validarEmail(email)) { valido = false; marcar(emailInput, false); }
            else { marcar(emailInput, true); }
            
            if (!pwd || pwd.length < 6) { valido = false; marcar(pwdInput, false); }
            else { marcar(pwdInput, true); }
            
            if (!valido) {
                cw.mostrarModal("⚠️ Email válido y contraseña mínimo 6 caracteres");
                return;
            }
            rest.registrarUsuario(email, pwd);
        });
    };

    this.mostrarLogin = function() {
        $("#fmLogin, #fmRegistro").remove();
        let cadena = `
            <div id="fmLogin" class="glass-card p-4 fade-in" style="max-width: 400px; margin: 0 auto;">
                <h3 class="text-gradient text-center mb-4">🔐 Iniciar Sesión</h3>
                <form>
                    <div class="form-group">
                        <label class="text-secondary">Email:</label>
                        <input type="email" class="form-control bg-dark text-white border-secondary" id="loginEmail" placeholder="tu@email.com">
                    </div>
                    <div class="form-group">
                        <label class="text-secondary">Contraseña:</label>
                        <input type="password" class="form-control bg-dark text-white border-secondary" id="loginPwd" placeholder="Tu contraseña">
                    </div>
                    <button type="submit" id="btnLogin" class="btn-aurora btn-block">Entrar</button>
                    <div class="text-center mt-3">
                        <a href="/auth/google" title="Iniciar sesión con Google">
                            <img src="/cliente/web_light_rd_SI@1x.png" alt="Google" style="height:40px;">
                        </a>
                    </div>
                    <div class="text-center mt-3">
                        <a href="#" id="linkIrRegistro" class="text-secondary">¿No tienes cuenta? <span class="text-gradient">Regístrate</span></a>
                    </div>
                </form>
            </div>
        `;
        $("#registro").html(cadena);
        
        // Link para ir a registro
        $("#linkIrRegistro").on("click", (e) => {
            e.preventDefault();
            this.mostrarRegistro();
        });
        
        const emailInput = $("#loginEmail");
        const pwdInput = $("#loginPwd");
        
        const validarEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
        const marcar = (input, ok) => {
            input.removeClass("is-valid is-invalid").addClass(ok ? "is-valid" : "is-invalid");
        };
        
        $("#btnLogin").on("click", function(e) {
            e.preventDefault();
            let email = emailInput.val().trim();
            let pwd = pwdInput.val();
            let valido = true;
            
            if (!validarEmail(email)) { valido = false; marcar(emailInput, false); }
            else { marcar(emailInput, true); }
            
            if (!pwd) { valido = false; marcar(pwdInput, false); }
            else { marcar(pwdInput, true); }
            
            if (!valido) {
                cw.mostrarModal("⚠️ Introduce credenciales válidas");
                return;
            }
            rest.loginUsuario({email: email, password: pwd});
        });
    };

    // Actualizar estado de la mesa (llamado desde WebSocket)
    this.actualizarEstadoMesa = function(datos) {
        if (!datos) return;
        
        // Actualizar barras de vida y estados de los equipos
        ['miEquipo', 'equipoRival'].forEach((equipo, idx) => {
            const equipoData = idx === 0 ? datos.miEquipo : datos.equipoRival;
            const container = idx === 0 ? $('#miEquipo') : $('#equipoRival');
            
            if (equipoData && container.length) {
                equipoData.forEach((luchador, i) => {
                    const card = container.find(`.fighter-card:eq(${i})`);
                    if (card.length && luchador) {
                        const porc = (luchador.vidaActual / luchador.vida) * 100;
                        card.find('.health-bar-fill').css('width', porc + '%');
                        card.find('.health-text').text(`${luchador.vidaActual}/${luchador.vida}`);
                        
                        if (luchador.vidaActual <= 0) {
                            card.addClass('derrotado').css('opacity', '0.4');
                        }
                    }
                });
            }
        });
        
        // Actualizar turno
        if (datos.turno) {
            cw.esMiTurno = (datos.turno === ws.nick);
            $('#turnoIndicador').text(cw.esMiTurno ? '🎯 Tu turno' : '⏳ Turno rival');
            // Sincronizar barra de temporizador local usando el timestamp servidor
            try {
                const inicio = datos.turnoInicio || Date.now();
                cw.startTurnTimerUI(30, inicio);
            } catch (e) {
                console.error('No se pudo iniciar timer sincronizado:', e);
            }
        }
    };
}
