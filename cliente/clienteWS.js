function ClienteWS(){
    this.socket = undefined;
    this.nick = undefined;
    this.codigo = undefined;
    this.email = undefined;
    this.monedas = 0;
    this.avatar = null; // Avatar del usuario

    this.ini = function(){
        this.socket = io.connect();
        this.lanzarServidorWS();
    };

    // ==================== PARTIDA 3v3 ====================
    
    // Crear partida con equipo de 3 personajes (array de UIDs)
    this.crearPartida = function(equipo){
        if (!equipo || equipo.length !== 3) {
            cw.mostrarModal("Debes seleccionar exactamente 3 personajes");
            return;
        }
        this.socket.emit("crearPartida", {
            email: this.email,
            nick: this.nick,
            equipo: equipo
        });
    };

    // Unirse a partida con equipo de 3 personajes
    this.unirAPartida = function(codigo, equipo){
        if (!equipo || equipo.length !== 3) {
            cw.mostrarModal("Debes seleccionar exactamente 3 personajes");
            return;
        }
        this.socket.emit("unirAPartida", {
            email: this.email,
            nick: this.nick,
            codigo: codigo,
            equipo: equipo
        });
    };

    // Realizar accion de ataque (indice atacante y objetivo)
    this.realizarAccion = function(indiceAtacante, indiceObjetivo){
        this.socket.emit("realizarAccion", {
            codigo: this.codigo,
            nick: this.nick,
            indiceAtacante: indiceAtacante,
            indiceObjetivo: indiceObjetivo
        });
    };

    // === v2.0: Usar Ultimate ===
    this.usarUltimate = function(indiceAtacante, indiceObjetivo){
        this.socket.emit("usarUltimate", {
            codigo: this.codigo,
            nick: this.nick,
            indiceAtacante: indiceAtacante,
            indiceObjetivo: indiceObjetivo
        });
    };

    // Defender con un personaje
    this.defender = function(indiceLuchador){
        this.socket.emit("defender", {
            codigo: this.codigo,
            nick: this.nick,
            indiceLuchador: indiceLuchador
        });
    };

    // Rendirse
    this.rendirse = function(){
        this.socket.emit("rendirse", {
            codigo: this.codigo,
            nick: this.nick
        });
    };

    // Obtener estado actual de la partida
    this.obtenerEstadoMesa = function(){
        this.socket.emit("obtenerEstadoMesa", {
            codigo: this.codigo
        });
    };

    // Solicitar lista de partidas disponibles al servidor
    this.solicitarListaPartidas = function(){
        if (this.socket && this.socket.connected) {
            this.socket.emit('solicitarListaPartidas');
        }
    };

    // Método de prueba para solicitar al servidor aplicar XP a una instancia
    this.testAplicarXP = function(uid, cantidad){
        if (!this.socket || !this.socket.connected) {
            console.warn('Socket no conectado');
            return;
        }
        this.socket.emit('testAplicarXP', {
            email: this.email,
            uid: uid,
            cantidad: cantidad
        });
    };

    // Eliminar partida
    this.eliminarPartida = function(codigo){
        this.socket.emit("eliminarPartida", {
            nick: this.nick,
            codigo: codigo
        });
    };

    // ==================== LISTENERS ====================
    
    this.lanzarServidorWS = function(){
        let cli = this;

        this.socket.on("connect", function(){
            console.log("Conectado al servidor WebSocket");
            
            // === RECONEXIÓN EN CALIENTE ===
            // Si el usuario ya tiene email/nick y está en una partida, intentar reconectar
            if (cli.email && cli.codigo) {
                console.log("Reconectando jugador a partida:", cli.codigo);
                cli.socket.emit("reconectarJugador", {
                    email: cli.email,
                    nick: cli.nick,
                    codigo: cli.codigo
                });
            }
        });

        this.socket.on("disconnect", function(){
            console.log("Desconectado del servidor WebSocket");
        });

        // Chat global (volátil) - Ya no se usa, dejado por compatibilidad
        this.socket.on("chatMessage", function(datos){
            // Chat global desactivado - ahora solo chat de batalla
        });

        // Chat de batalla (por partida, volátil)
        this.socket.on("chatBatalla", function(datos){
            if (datos && datos.nick && datos.mensaje) {
                cw.agregarMensajeBatalla(datos.nick, datos.mensaje);
            }
        });

        // Partida creada exitosamente
        this.socket.on("partidaCreada", function(datos){
            console.log("Partida creada:", datos.codigo);
            cli.codigo = datos.codigo;
            cw.mostrarEsperandoRival();
        });

        // Unido a partida exitosamente
        this.socket.on("unidoAPartida", function(datos){
            console.log("Unido a partida:", datos.codigo);
            cli.codigo = datos.codigo;
        });

        // Error al crear/unir partida
        this.socket.on("errorPartida", function(datos){
            console.error("Error partida:", datos.mensaje);
            cw.mostrarModal(datos.mensaje);
        });

        // Partida eliminada
        this.socket.on("partidaEliminada", function(datos){
            console.log("Partida eliminada:", datos.codigo);
            cli.codigo = undefined;
            // Volver a la sección de batalla
            cw.navegarA('sec-batalla');
        });

        // Batalla empieza (ambos jugadores conectados)
        this.socket.on("empezarBatalla", function(datos){
            console.log("Empieza la batalla:", datos);
            cw.mostrarCombate(datos);
        });

        // Accion realizada (ataque)
        this.socket.on("accionRealizada", function(datos){
            console.log("Accion realizada:", datos);
            cw.actualizarBatalla(datos);
        });

        // === v2.0: Ultimate usada ===
        this.socket.on("ultimateUsada", function(datos){
            console.log("Ultimate usada:", datos);
            cw.procesarUltimate(datos);
        });

        // Turno forzado por inactividad (servidor)
        this.socket.on("turnoForzado", function(datos){
            console.log("Turno forzado:", datos);
            try {
                if (datos && datos.nuevoTurno) {
                    cw.actualizarIndicadorTurno(datos.nuevoTurno);
                }
                const texto = datos && datos.nuevoTurno ?
                    `El turno ha sido forzado por inactividad. Ahora es el turno de ${datos.nuevoTurno}.` :
                    'El turno ha sido forzado por inactividad.';
                cw.mostrarModal(`<div class="text-center"><p>${texto}</p></div>`);
                setTimeout(() => cw.cerrarModalPersonalizado(), 2500);
            } catch (e) {
                console.error('Error manejando turnoForzado:', e);
            }
        });

        // Defensa realizada
        this.socket.on("defensaRealizada", function(datos){
            console.log("Defensa realizada:", datos);
            cw.actualizarBatalla(datos);
        });

        // Error en accion
        this.socket.on("errorAccion", function(datos){
            console.error("Error accion:", datos.mensaje);
            cw.mostrarModal(datos.mensaje);
        });

        // Partida finalizada
        this.socket.on("finPartida", function(datos){
            console.log("Partida finalizada:", datos);
            cw.mostrarFinPartida(datos);
        });

        // Resultado de prueba de aplicación de XP
        this.socket.on("xpAplicado", function(datos){
            console.log('xpAplicado recibido:', datos);
            if (!datos) return;
            if (datos.error) {
                cw.mostrarModal('Error aplicando XP: ' + datos.error);
                return;
            }
            // Update local inventory and detail view live (no modal for each XP application)
                if (datos.resultados && datos.resultados.length) {
                    datos.resultados.forEach(res => {
                        // Update cw.inventarioCompleto entry if present
                        if (cw.inventarioCompleto && Array.isArray(cw.inventarioCompleto)) {
                            const inst = cw.inventarioCompleto.find(i => i.uid === res.uid);
                            if (inst) {
                                inst.nivel = res.nivelActual;
                                inst.xpActual = res.xpActual;
                                // update stats/poder if provided
                                if (res.stats) inst.stats = res.stats;
                                if (res.poder !== undefined) inst.poder = res.poder;
                            }
                        }

                        // If the detail view for this UID is open, update its DOM
                        if (cw.currentDetalleUID && cw.currentDetalleUID === res.uid) {
                            // Update level display
                            $('#detalle-nivel').text(res.nivelActual);
                            // Update xp bar and text
                            const pct = (res.xpActual / res.xpNecesaria) * 100;
                            $('#detalle-xp-bar').css('width', pct + '%');
                            $('#detalle-xp-text').text(res.xpActual + '/' + res.xpNecesaria);

                            // Update stats numeric values and progress bars
                            if (res.stats) {
                                const stats = res.stats;
                                $('#vistaDetallePersonaje .stat-row').each(function(){
                                    const label = $(this).find('.stat-label').text().trim();
                                    if (label.indexOf('HP') !== -1 || label.indexOf('Vida') !== -1) {
                                        if (stats.vida !== undefined) {
                                            $(this).find('.stat-value').text(stats.vida);
                                            $(this).find('.hp-bar').css('width', Math.min(stats.vida / 3.5, 100) + '%');
                                        }
                                    } else if (label.indexOf('ATK') !== -1 || label.indexOf('ATK') !== -1) {
                                        if (stats.ataque !== undefined) {
                                            $(this).find('.stat-value').text(stats.ataque);
                                            $(this).find('.atk-bar').css('width', Math.min(stats.ataque / 1.5, 100) + '%');
                                        }
                                    } else if (label.indexOf('DEF') !== -1 || label.indexOf('DEF') !== -1) {
                                        if (stats.defensa !== undefined) {
                                            $(this).find('.stat-value').text(stats.defensa);
                                            $(this).find('.def-bar').css('width', Math.min(stats.defensa / 1.2, 100) + '%');
                                        }
                                    }
                                });
                            }

                            // If level up occurred while viewing detail, show concise level-up modal
                            if (res.subioNivel) {
                                const levelUpHTML = `
                                    <div class="text-center">
                                        <h3>🎉 ¡LEVEL UP!</h3>
                                        <p>${res.nombre}: Nivel ${res.nivelAnterior} → ${res.nivelActual}</p>
                                        <div class="xp-bar-container">
                                            <div class="xp-bar" style="width:${(res.xpActual / res.xpNecesaria) * 100}%"></div>
                                            <span class="xp-text">${res.xpActual}/${res.xpNecesaria}</span>
                                        </div>
                                    </div>
                                `;
                                cw.mostrarModal(levelUpHTML);
                                setTimeout(() => cw.cerrarModalPersonalizado(), 2500);
                            }
                        } else {
                            // If detail not open: apply stats in background (no modal)
                            if (res.subioNivel) {
                                // Do not show modal when not viewing detail; stats will be seen when reopening
                                console.log('Nivel subido en background para UID', res.uid);
                            }
                        }
                    });
                }

                // Refresh inventory list to keep everything consistent
                setTimeout(() => { rest.obtenerInventario(); }, 400);
        });

        // Estado de la mesa actualizado
        this.socket.on("estadoMesa", function(datos){
            console.log("Estado mesa:", datos);
            cw.actualizarEstadoMesa(datos);
        });

        // Lista de partidas disponibles
        this.socket.on("listaPartidas", function(lista){
            console.log("Lista partidas:", lista);
            cw.mostrarListaPartidas(lista);
        });

        // Confirmación de reconexión exitosa
        this.socket.on("reconexionExitosa", function(datos){
            console.log("✅ Reconexión exitosa a partida:", datos.codigo);
        });

        // Error en reconexión
        this.socket.on("errorReconexion", function(datos){
            console.warn("⚠️ Error reconexión:", datos.mensaje);
            // Si la partida ya no existe, limpiar el código local
            cli.codigo = undefined;
        });
    };

    this.ini();
}
