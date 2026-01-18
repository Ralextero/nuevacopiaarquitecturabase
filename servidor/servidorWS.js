function ServidorWS(){
    this.lanzarServidor = function(io, sistema){
        let srv = this;
        // Temporizadores de turno por partida (clave: codigo)
        let turnTimers = {};

        // Inicia el temporizador de turno para una partida (ms)
        const TURN_DURATION_MS = 30000;
        function startTurnTimer(codigo) {
            clearTurnTimer(codigo);
            let partida = sistema.partidas[codigo];
            if (!partida || partida.estado !== 'en_curso') return;
            // Ensure turnoInicio is set
            if (!partida.turnoInicio) partida.turnoInicio = Date.now();
            const elapsed = Date.now() - partida.turnoInicio;
            const remaining = Math.max(0, TURN_DURATION_MS - elapsed);

            if (remaining === 0) {
                // If already expired, force immediate change using sistema.saltarTurno
                try {
                    const anterior = partida.turno;
                    // Use sistema.saltarTurno so pasivas/estados se procesen y se incluyan en el log
                    const res = sistema.saltarTurno(codigo, anterior);
                    const nuevo = res && !res.error ? res.turno : (partida.jugadores.find(j => j.nick !== anterior) || {}).nick;
                    const payload = Object.assign({
                        anteriorTurno: anterior,
                        nuevoTurno: nuevo,
                        motivo: 'timeout'
                    }, res || {});
                    srv.enviarATodosEnPartida(io, codigo, 'turnoForzado', payload);
                    // Emitir también 'turnoSaltado' para reutilizar el renderizado cliente
                    try { srv.enviarATodosEnPartida(io, codigo, 'turnoSaltado', payload); } catch(e) {}
                    // Enviar estado de mesa actualizado
                    srv.enviarATodosEnPartida(io, codigo, 'estadoMesa', sistema.obtenerEstadoMesa(codigo));
                    // Start timer for new turn
                    startTurnTimer(codigo);
                } catch (e) {
                    console.log('Error en temporizador de turno inmediato:', e);
                }
                return;
            }

            turnTimers[codigo] = setTimeout(() => {
                try {
                    let partidaNow = sistema.partidas[codigo];
                    if (!partidaNow || partidaNow.estado !== 'en_curso') return;
                    const anterior = partidaNow.turno;
                    const rival = partidaNow.jugadores.find(j => j.nick !== anterior);
                    if (!rival) return;
                    // Forzar cambio de turno: usar sistema.saltarTurno para procesar pasivas/estados
                    try {
                        const res = sistema.saltarTurno(codigo, anterior);
                        const nuevo = res && !res.error ? res.turno : rival.nick;
                        const payload2 = Object.assign({
                            anteriorTurno: anterior,
                            nuevoTurno: nuevo,
                            motivo: 'timeout'
                        }, res || {});
                        srv.enviarATodosEnPartida(io, codigo, 'turnoForzado', payload2);
                        // Emitir también 'turnoSaltado' para que el cliente muestre logs exactamente igual
                        try { srv.enviarATodosEnPartida(io, codigo, 'turnoSaltado', payload2); } catch(e) {}
                        srv.enviarATodosEnPartida(io, codigo, 'estadoMesa', sistema.obtenerEstadoMesa(codigo));
                    } catch (e) {
                        console.log('Error forzando salto de turno en timeout:', e);
                    }
                    // Reiniciar temporizador para el nuevo turno
                    startTurnTimer(codigo);
                } catch (e) {
                    console.log('Error en temporizador de turno:', e);
                }
            }, remaining);
        }

        function clearTurnTimer(codigo) {
            if (turnTimers[codigo]) {
                clearTimeout(turnTimers[codigo]);
                delete turnTimers[codigo];
            }
        }
        io.on('connection', function(socket){
            console.log("Capa WS activa");
            
            // Enviar lista de partidas al usuario que se conecta
            let lista = sistema.obtenerPartidasDisponibles();
            srv.enviarAlRemitente(socket, "listaPartidas", lista);

            // ==================== CHAT GLOBAL (VOLÁTIL) ====================
            // Datos esperados: { nick: String, mensaje: String }
            socket.on("chatMessage", function(datos){
                if (datos && datos.nick && datos.mensaje) {
                    // Reenviar a todos excepto al remitente
                    srv.enviarATodosMenosRemitente(socket, "chatMessage", {
                        nick: datos.nick,
                        mensaje: datos.mensaje
                    });
                }
            });

            // ==================== CHAT DE BATALLA (Por partida, volátil) ====================
            // Datos esperados: { codigo: String, nick: String, mensaje: String }
            socket.on("chatBatalla", function(datos){
                if (datos && datos.codigo && datos.nick && datos.mensaje) {
                    // Reenviar solo a la sala de la partida (excepto al remitente)
                    socket.to(datos.codigo).emit("chatBatalla", {
                        nick: datos.nick,
                        mensaje: datos.mensaje
                    });
                }
            });

            // ==================== CREAR PARTIDA (3v3) ====================
            // Datos esperados: { email: String, nick: String, equipo: [uid1, uid2, uid3] }
            socket.on("crearPartida", function(datos){
                let resultado = sistema.crearPartida(datos.email, datos.equipo, datos.nick);
                if (resultado.codigo !== -1){
                    socket.join(resultado.codigo);
                    srv.enviarAlRemitente(socket, "partidaCreada", {
                        codigo: resultado.codigo,
                        mensaje: resultado.mensaje
                    });
                    let lista = sistema.obtenerPartidasDisponibles();
                    srv.enviarGlobal(io, "listaPartidas", lista);
                } else {
                    srv.enviarAlRemitente(socket, "errorPartida", {
                        mensaje: resultado.mensaje
                    });
                }
            });

            // ==================== UNIRSE A PARTIDA (3v3) ====================
            // Datos esperados: { email: String, nick: String, codigo: String, equipo: [uid1, uid2, uid3] }
            socket.on("unirAPartida", function(datos){
                let res = sistema.unirAPartida(datos.email, datos.codigo, datos.equipo, datos.nick);
                if (res.codigo !== -1){
                    socket.join(datos.codigo);
                    srv.enviarAlRemitente(socket, "unidoAPartida", {
                        codigo: datos.codigo,
                        mensaje: res.mensaje
                    });
                    
                    // Obtener estado completo de la mesa (6 personajes)
                    let estadoMesa = sistema.obtenerEstadoMesa(datos.codigo);
                    
                    // Enviar a todos en la partida el estado completo para empezar batalla
                    srv.enviarATodosEnPartida(io, datos.codigo, "empezarBatalla", {
                        codigo: datos.codigo,
                        owner: res.owner,
                        rival: res.rival,
                        estadoMesa: estadoMesa
                    });

                    // Iniciar temporizador de turno para la nueva partida
                    try { startTurnTimer(datos.codigo); } catch(e) { console.log('Error iniciando timer:', e); }

                    let lista = sistema.obtenerPartidasDisponibles();
                    srv.enviarGlobal(io, "listaPartidas", lista);
                } else {
                    srv.enviarAlRemitente(socket, "errorPartida", {
                        mensaje: res.mensaje
                    });
                }
            });

            // ==================== REALIZAR ACCIÓN (ATACAR 3v3) ====================
            // Datos esperados: { codigo: String, nick: String, indiceAtacante: Number, indiceObjetivo: Number }
            socket.on("realizarAccion", function(datos){
                // Reiniciar/limpiar temporizador mientras se procesa la acción
                try { clearTurnTimer(datos.codigo); } catch(e) {}

                let res = sistema.realizarAccion(
                    datos.codigo, 
                    datos.nick, 
                    datos.indiceAtacante, 
                    datos.indiceObjetivo
                );
                if (res && !res.error){
                    srv.enviarATodosEnPartida(io, datos.codigo, "accionRealizada", res);
                    
                    // Si hay ganador, notificar fin de partida
                    if (res.ganador) {
                        // Final de partida - limpiar timer
                        try { clearTurnTimer(datos.codigo); } catch(e) {}
                        
                        // === SISTEMA DE XP ===
                        let partida = sistema.partidas[datos.codigo];
                        let xpResultados = { ganador: [], perdedor: [] };
                        const xpConfig = require('./data.js').XPBatalla || { ganador: 50, perdedor: 15 };
                        
                        if (partida && partida.jugadores) {
                            partida.jugadores.forEach(jugador => {
                                let usuario = sistema.usuarios[jugador.email];
                                if (usuario) {
                                    // Obtener UIDs del equipo que participó
                                    let equipoUIDs = jugador.equipo.map(p => p.uid);
                                    let esGanador = jugador.nick === res.ganador;
                                    let xpOtorgada = esGanador ? xpConfig.ganador : xpConfig.perdedor;
                                    
                                    // Aplicar XP y obtener resultados de level up
                                    let resultadosXP = sistema.aplicarXPEquipo(usuario, equipoUIDs, xpOtorgada);
                                    
                                    if (esGanador) {
                                        xpResultados.ganador = resultadosXP;
                                    } else {
                                        xpResultados.perdedor = resultadosXP;
                                    }
                                    
                                    // Guardar cambios en MongoDB
                                    if (sistema.cad.actualizarInventario) {
                                        sistema.cad.actualizarInventario(usuario, function(r) {
                                            console.log('XP y niveles actualizados para:', jugador.nick);
                                        });
                                    }
                                }
                            });
                        }
                        
                        srv.enviarATodosEnPartida(io, datos.codigo, "finPartida", {
                            ganador: res.ganador,
                            recompensa: res.recompensa,
                            estadoMesa: res.estadoMesa,
                            xpResultados: xpResultados
                        });
                    } else {
                        // Iniciar temporizador para el nuevo turno
                        try { startTurnTimer(datos.codigo); } catch(e) {}
                    }
                } else if (res && res.error) {
                    srv.enviarAlRemitente(socket, "errorAccion", {
                        mensaje: res.mensaje
                    });
                }
            });

            // Mantener compatibilidad con evento "atacar" antiguo
            socket.on("atacar", function(datos){
                try { clearTurnTimer(datos.codigo); } catch(e) {}

                let res = sistema.realizarAccion(
                    datos.codigo, 
                    datos.nick,
                    datos.indiceAtacante || 0,
                    datos.indiceObjetivo || 0
                );
                if (res && !res.error){
                    srv.enviarATodosEnPartida(io, datos.codigo, "ataqueRealizado", res);
                    srv.enviarATodosEnPartida(io, datos.codigo, "accionRealizada", res);
                    if (res.ganador) {
                        try { clearTurnTimer(datos.codigo); } catch(e) {}
                        srv.enviarATodosEnPartida(io, datos.codigo, "finPartida", {
                            ganador: res.ganador,
                            recompensa: res.recompensa,
                            estadoMesa: res.estadoMesa
                        });
                    } else {
                        try { startTurnTimer(datos.codigo); } catch(e) {}
                    }
                }
            });

            // ==================== USAR ULTIMATE v2.0 ====================
            // Datos esperados: { codigo: String, nick: String, indiceAtacante: Number, indiceObjetivo: Number }
            socket.on("usarUltimate", function(datos){
                try { clearTurnTimer(datos.codigo); } catch(e) {}

                let res = sistema.usarUltimate(
                    datos.codigo, 
                    datos.nick, 
                    datos.indiceAtacante, 
                    datos.indiceObjetivo
                );
                
                if (res && !res.error){
                    // Emitir resultado de la Ultimate
                    srv.enviarATodosEnPartida(io, datos.codigo, "ultimateUsada", res);
                    
                    // Si hay ganador, notificar fin de partida
                    if (res.ganador) {
                        try { clearTurnTimer(datos.codigo); } catch(e) {}
                        
                        // === SISTEMA DE XP ===
                        let partida = sistema.partidas[datos.codigo];
                        let xpResultados = { ganador: [], perdedor: [] };
                        const xpConfig = require('./data.js').XPBatalla || { ganador: 50, perdedor: 15 };
                        
                        if (partida && partida.jugadores) {
                            partida.jugadores.forEach(jugador => {
                                let usuario = sistema.usuarios[jugador.email];
                                if (usuario) {
                                    let equipoUIDs = jugador.equipo.map(p => p.uid);
                                    let esGanador = jugador.nick === res.ganador;
                                    let xpOtorgada = esGanador ? xpConfig.ganador : xpConfig.perdedor;
                                    let resultadosXP = sistema.aplicarXPEquipo(usuario, equipoUIDs, xpOtorgada);
                                    
                                    if (esGanador) {
                                        xpResultados.ganador = resultadosXP;
                                    } else {
                                        xpResultados.perdedor = resultadosXP;
                                    }
                                    
                                    if (sistema.cad.actualizarInventario) {
                                        sistema.cad.actualizarInventario(usuario, function(r) {
                                            console.log('XP y niveles actualizados tras Ultimate para:', jugador.nick);
                                        });
                                    }
                                }
                            });
                        }
                        
                        srv.enviarATodosEnPartida(io, datos.codigo, "finPartida", {
                            ganador: res.ganador,
                            recompensa: res.recompensa,
                            estadoMesa: res.estadoMesa,
                            xpResultados: xpResultados
                        });
                    } else {
                        try { startTurnTimer(datos.codigo); } catch(e) {}
                    }
                } else if (res && res.error) {
                    srv.enviarAlRemitente(socket, "errorAccion", {
                        mensaje: res.mensaje
                    });
                }
            });

            // ==================== DEFENDER (3v3) ====================
            // Datos esperados: { codigo: String, nick: String, indiceLuchador: Number }
            socket.on("defender", function(datos){
                try { clearTurnTimer(datos.codigo); } catch(e) {}

                let res = sistema.defender(datos.codigo, datos.nick, datos.indiceLuchador || 0);
                if (res && !res.error){
                    // Solo enviar un evento para evitar duplicados en el log
                    srv.enviarATodosEnPartida(io, datos.codigo, "defensaRealizada", res);
                    // Iniciar temporizador para el nuevo turno
                    try { startTurnTimer(datos.codigo); } catch(e) {}
                } else if (res && res.error) {
                    srv.enviarAlRemitente(socket, "errorAccion", {
                        mensaje: res.mensaje
                    });
                }
            });

            // ==================== SALTAR TURNO ====================
            // Datos esperados: { codigo: String, nick: String }
            socket.on("saltarTurno", function(datos){
                try { clearTurnTimer(datos.codigo); } catch(e) {}

                let res = sistema.saltarTurno(datos.codigo, datos.nick);
                if (res && !res.error){
                    srv.enviarATodosEnPartida(io, datos.codigo, "turnoSaltado", res);
                    // Emitir estadoMesa actualizado para que el cliente tenga logs y estado sincronizados
                    try { srv.enviarATodosEnPartida(io, datos.codigo, 'estadoMesa', sistema.obtenerEstadoMesa(datos.codigo)); } catch(e) {}
                    try { startTurnTimer(datos.codigo); } catch(e) {}
                } else if (res && res.error) {
                    srv.enviarAlRemitente(socket, "errorAccion", {
                        mensaje: res.mensaje
                    });
                }
            });

            // ==================== OBTENER ESTADO DE MESA ====================
            socket.on("obtenerEstadoMesa", function(datos){
                let estadoMesa = sistema.obtenerEstadoMesa(datos.codigo);
                if (estadoMesa) {
                    srv.enviarAlRemitente(socket, "estadoMesa", estadoMesa);
                }
            });

            // Petición explícita para obtener la lista de partidas disponibles
            socket.on("solicitarListaPartidas", function(){
                try {
                    let lista = sistema.obtenerPartidasDisponibles();
                    srv.enviarAlRemitente(socket, "listaPartidas", lista);
                } catch (e) {
                    console.log('Error al enviar listaPartidas:', e);
                }
            });

            // ==================== TEST: Aplicar XP a una instancia (solo para pruebas desde cliente) ====
            // Datos esperados: { email: String, uid: String, cantidad: Number }
            socket.on("testAplicarXP", function(datos){
                try {
                    if (!datos || !datos.email || !datos.uid || !datos.cantidad) {
                        srv.enviarAlRemitente(socket, "xpAplicado", { error: 'Datos incompletos' });
                        return;
                    }

                    let usuario = sistema.usuarios[datos.email];
                    if (!usuario) {
                        srv.enviarAlRemitente(socket, "xpAplicado", { error: 'Usuario no encontrado' });
                        return;
                    }

                    // Aplicar XP usando la función del sistema (devuelve resultados por instancia)
                    let resultados = sistema.aplicarXPEquipo(usuario, [datos.uid], Number(datos.cantidad) || 0);

                    // Persistir cambios si existe el CAD
                    if (sistema.cad && sistema.cad.actualizarInventario) {
                        sistema.cad.actualizarInventario(usuario, function(r){
                            // Ignorar resultado en pruebas
                        });
                    }

                    // Enviar resultado al cliente que solicitó la prueba
                    srv.enviarAlRemitente(socket, "xpAplicado", {
                        uid: datos.uid,
                        cantidad: datos.cantidad,
                        resultados: resultados
                    });
                } catch (e) {
                    console.log('Error en testAplicarXP:', e);
                    srv.enviarAlRemitente(socket, "xpAplicado", { error: 'Error interno' });
                }
            });

            // ==================== ELIMINAR PARTIDA ====================
            socket.on("eliminarPartida", function(datos){
                let res = sistema.eliminarPartida(datos.codigo, datos.nick);
                if (res.codigo !== -1){
                    srv.enviarAlRemitente(socket, "partidaEliminada", {"codigo": datos.codigo});
                    srv.enviarATodosEnPartida(io, datos.codigo, "partidaCancelada", {
                        codigo: datos.codigo,
                        mensaje: "El creador ha cancelado la partida"
                    });
                    let lista = sistema.obtenerPartidasDisponibles();
                    srv.enviarGlobal(io, "listaPartidas", lista);
                }
            });

            // ==================== RECONEXIÓN EN CALIENTE ====================
            // Cuando un jugador se reconecta (micro-desconexión), actualizar su socket en la sala
            socket.on("reconectarJugador", function(datos){
                if (!datos || !datos.codigo || !datos.email) {
                    srv.enviarAlRemitente(socket, "errorReconexion", {
                        mensaje: "Datos de reconexión incompletos"
                    });
                    return;
                }

                let partida = sistema.partidas[datos.codigo];
                if (!partida) {
                    srv.enviarAlRemitente(socket, "errorReconexion", {
                        mensaje: "La partida ya no existe"
                    });
                    return;
                }

                // Verificar que el usuario pertenece a esta partida
                let jugadorEnPartida = partida.jugadores.find(j => j.email === datos.email);
                if (!jugadorEnPartida) {
                    srv.enviarAlRemitente(socket, "errorReconexion", {
                        mensaje: "No perteneces a esta partida"
                    });
                    return;
                }

                // Re-unir al socket a la sala de la partida
                socket.join(datos.codigo);
                console.log("🔄 Usuario reconectado:", datos.nick || datos.email, "a partida:", datos.codigo);

                // Confirmar reconexión exitosa
                srv.enviarAlRemitente(socket, "reconexionExitosa", {
                    codigo: datos.codigo,
                    mensaje: "Reconectado a la partida"
                });

                // Enviar estado actual de la mesa para sincronizar
                let estadoMesa = sistema.obtenerEstadoMesa(datos.codigo);
                if (estadoMesa) {
                    srv.enviarAlRemitente(socket, "estadoMesa", estadoMesa);
                }
            });

            // ==================== RENDIRSE ====================
            socket.on("rendirse", function(datos){
                let partida = sistema.partidas[datos.codigo];
                if (partida && partida.estado === "en_curso") {
                    let rival = partida.jugadores.find(j => j.nick !== datos.nick);
                    if (rival) {
                        partida.estado = "finalizada";
                        partida.ganador = rival.nick;
                        
                        // Recompensa al ganador - buscar por email, no por nick
                        let ganadorObj = sistema.usuarios[rival.email];
                        if (ganadorObj) {
                            ganadorObj.monedas += 50; // Recompensa por rendición del rival
                            if (sistema.cad.actualizarMonedas) {
                                sistema.cad.actualizarMonedas(ganadorObj, function(res){
                                    console.log("Monedas actualizadas por rendición");
                                });
                            }
                        }
                        // Limpiar temporizador de la partida
                        try { clearTurnTimer(datos.codigo); } catch(e) {}
                        
                        // === SISTEMA DE XP (rendición) ===
                        let xpResultados = { ganador: [], perdedor: [] };
                        const xpConfig = require('./data.js').XPBatalla || { ganador: 50, perdedor: 15 };
                        
                        partida.jugadores.forEach(jugador => {
                            let usuario = sistema.usuarios[jugador.email];
                            if (usuario) {
                                let equipoUIDs = jugador.equipo.map(p => p.uid);
                                let esGanador = jugador.nick === rival.nick;
                                let xpOtorgada = esGanador ? xpConfig.ganador : xpConfig.perdedor;
                                
                                let resultadosXP = sistema.aplicarXPEquipo(usuario, equipoUIDs, xpOtorgada);
                                
                                if (esGanador) {
                                    xpResultados.ganador = resultadosXP;
                                } else {
                                    xpResultados.perdedor = resultadosXP;
                                }
                                
                                if (sistema.cad.actualizarInventario) {
                                    sistema.cad.actualizarInventario(usuario, function(r) {
                                        console.log('XP actualizada por rendición para:', jugador.nick);
                                    });
                                }
                            }
                        });
                        
                        srv.enviarATodosEnPartida(io, datos.codigo, "finPartida", {
                            ganador: rival.nick,
                            rendicion: true,
                            jugadorRendido: datos.nick,
                            recompensa: 50,
                            estadoMesa: sistema.obtenerEstadoMesa(datos.codigo),
                            xpResultados: xpResultados
                        });
                    }
                }
            });
        });
    }

    this.enviarAlRemitente=function(socket,mensaje,datos){
        socket.emit(mensaje,datos);
    }

    this.enviarATodosMenosRemitente=function(socket,mens,datos){
        socket.broadcast.emit(mens,datos);
    }

    this.enviarGlobal=function(io,mens,datos){
        io.emit(mens,datos);
    }

    this.enviarATodosEnPartida=function(io, codigo, mens, datos){
        io.to(codigo).emit(mens, datos);
    }
}

module.exports.ServidorWS = ServidorWS;