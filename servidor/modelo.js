const datos=require("./cad.js");
const correo=require("./email.js");
const bcrypt = require("bcrypt");
const data = require("./data.js");

function Sistema(test) {
    // Capa de acceso a datos (CAD)
    this.cad=new datos.CAD();
    if (!test){
        this.cad.conectar(function(db){
            console.log("Conectado a Mongo Atlas");
        });
    }
    this.usuarios = {};
    this.partidas = {};

    this.agregarUsuario = function(nick) {
        let res = { "nick": -1 };
        let id = nick;
        if (typeof nick === 'object') {
            id = nick.email;
        }
        
        if (!this.usuarios[id]) {
            if (typeof nick === 'object') {
                this.usuarios[id] = new Usuario(nick.email, nick.inventario, nick.monedas, nick.equipamiento);
                if (nick._id) {
                    this.usuarios[id]._id = nick._id;
                }
            } else {
                this.usuarios[id] = new Usuario(id);
            }
            res.nick = id;
            res.monedas = this.usuarios[id].monedas; // Devolver monedas
        } else {
            console.log("el nick " + id + " está en uso");
            // Si ya existe, devolver también las monedas para sincronizar
            res.nick = id;
            res.monedas = this.usuarios[id].monedas;
        }
        return res;
    }

    this.obtenerCodigo = function(){
        let codigo = Date.now().toString(36) + Math.random().toString(36).slice(2);
        return codigo;
    }

    // ==================== SISTEMA DE COMBATE 3v3 ====================
    
    // Valida que el usuario posea los 3 personajes del equipo
    this.validarEquipo = function(usuario, equipoUIDs) {
        if (!equipoUIDs || equipoUIDs.length !== 3) {
            return { valido: false, mensaje: "El equipo debe tener exactamente 3 personajes" };
        }
        
        // Validar que el usuario tenga inventario
        if (!usuario || !usuario.inventario || !Array.isArray(usuario.inventario)) {
            return { valido: false, mensaje: "El usuario no tiene un inventario válido" };
        }
        
        let equipoValidado = [];
        for (let uid of equipoUIDs) {
            let instancia = usuario.inventario.find(inst => inst.uid === uid);
            if (!instancia) {
                return { valido: false, mensaje: `No posees el personaje con uid: ${uid}` };
            }
            equipoValidado.push(instancia);
        }
        
        return { valido: true, equipo: equipoValidado };
    }

    // Construye un luchador para combate a partir de una instancia del inventario
    this.construirLuchador = function(instancia) {
        // Validar que la instancia sea válida
        if (!instancia || !instancia.idAnimal) return null;
        
        let animal = data.Animales.find(a => a.id === instancia.idAnimal);
        if (!animal) return null;
        
        // Stats base del personaje (con valores por defecto si no existen)
        let statsBase = {
            ataque: (instancia.stats && instancia.stats.ataque) || animal.ataque || 50,
            defensa: (instancia.stats && instancia.stats.defensa) || animal.defensa || 30,
            vida: (instancia.stats && instancia.stats.vida) || animal.vida || 100
        };
        
        // Calcular stats con equipamiento y sinergia elemental
        let statsFinales = this.calcularStatsConEquipamientoYSinergia(
            statsBase,
            instancia.equipo,
            animal.tipo
        );
        
        return {
            uid: instancia.uid,
            idAnimal: animal.id,
            nombre: animal.nombre,
            tipo: animal.tipo,
            img: animal.img,
            rareza: animal.rareza,
            nivel: instancia.nivel,
            rango: instancia.rango,
            // Stats de combate (incluye equipamiento)
            ataque: statsFinales.ataque,
            defensa: statsFinales.defensa,
            vida: statsFinales.vida,
            vidaActual: statsFinales.vida,
            // Nuevas propiedades v2.0
            velocidad: animal.velocidad || 50,
            pasiva: animal.pasiva || null,
            ultimate: animal.ultimate || null,
            mana: 0, // Sistema de maná (max 4)
            manaMax: 4,
            // Estado de combate
            estado: "activo", // "activo" | "derrotado"
            estaDefendiendo: false,
            // Equipamiento del personaje (para referencia)
            equipamiento: instancia.equipo || null
        };
    }
    
    // Calcula la velocidad total de un equipo (suma de velocidades)
    this.calcularVelocidadEquipo = function(equipo) {
        return equipo.reduce((total, personaje) => total + (personaje.velocidad || 50), 0);
    }

    // ==================== SISTEMA DE ULTIMATES v2.0 ====================
    // Usa la ultimate de un personaje basándose en el código de efecto
    this.usarUltimate = function(codigo, nick, indiceAtacante, indiceObjetivo) {
        let partida = this.partidas[codigo];
        
        // Validaciones básicas
        if (!partida) {
            return { error: true, mensaje: "Partida no encontrada" };
        }
        if (partida.turno !== nick) {
            return { error: true, mensaje: "No es tu turno" };
        }
        if (partida.estado !== "en_curso") {
            return { error: true, mensaje: "La partida no está en curso" };
        }
        
        let atacanteJugador = partida.jugadores.find(j => j.nick === nick);
        let defensorJugador = partida.jugadores.find(j => j.nick !== nick);
        
        if (!atacanteJugador || !defensorJugador) {
            return { error: true, mensaje: "Error al encontrar jugadores" };
        }
        
        let atacante = atacanteJugador.equipo[indiceAtacante];
        let objetivo = defensorJugador.equipo[indiceObjetivo];
        
        // Validar que el atacante esté activo
        if (!atacante || atacante.estado === "derrotado") {
            return { error: true, mensaje: "Tu personaje está derrotado" };
        }
        
        // === v2.0: Verificar si puede actuar (estados de control) ===
        if (!this.puedeActuar(atacante)) {
            let estadoImpide = atacante.estados?.find(e => 
                ["congelado", "aturdido", "paralizado", "dormido"].includes(e.tipo)
            );
            
            // NO cambiar turno - solo avisar
            return {
                error: true,
                noPuedeActuar: true,
                razon: estadoImpide ? estadoImpide.tipo : "estado",
                mensaje: `${atacante.nombre} no puede actuar (${estadoImpide ? estadoImpide.tipo : 'estado'})`
            };
        }
        
        // Validar que tenga ultimate
        if (!atacante.ultimate) {
            return { error: true, mensaje: "Este personaje no tiene ultimate" };
        }
        
        // Validar maná suficiente
        let costeUltimate = atacante.ultimate.coste || 4;
        if (atacante.mana < costeUltimate) {
            return { error: true, mensaje: `Maná insuficiente (necesitas ${costeUltimate}, tienes ${atacante.mana})` };
        }
        
        // Consumir maná
        atacante.mana -= costeUltimate;
        
        // === v2.0: Obtener buffs de pasivas para aplicar a daño de Ultimate ===
        let pasivaAtacante = this.checkPasiva(atacante, "atacar", {
            objetivo: objetivo,
            equipoAliado: atacanteJugador.equipo
        });
        
        // Calcular multiplicador de daño por buffs de pasiva
        let multiplicadorPasiva = 1;
        if (pasivaAtacante && pasivaAtacante.aplicada) {
            if (pasivaAtacante.multiplicadorAtaque) {
                multiplicadorPasiva *= pasivaAtacante.multiplicadorAtaque;
            }
            if (pasivaAtacante.bonusDanio) {
                multiplicadorPasiva *= (1 + pasivaAtacante.bonusDanio);
            }
        }
        
        let codigoEfecto = atacante.ultimate.efecto;
        let equipoAliado = atacanteJugador.equipo;
        let equipoRival = defensorJugador.equipo;
        
        let resultado = {
            accion: "ultimate",
            nombreUltimate: atacante.ultimate.nombre,
            descripcion: atacante.ultimate.desc,
            atacante: {
                nick: nick,
                indice: indiceAtacante,
                nombre: atacante.nombre,
                tipo: atacante.tipo
            },
            efectos: [],
            ganador: null,
            turno: defensorJugador.nick
        };
        
        // Procesar efecto con switch
        switch (codigoEfecto) {
            // ==================== 🔥 FUEGO ULTIMATES ====================
            // Salamandra - Llamarada: Crítico garantizado 200% daño
            case "crit_200": {
                if (!objetivo || objetivo.estado === "derrotado") {
                    return { error: true, mensaje: "Objetivo inválido" };
                }
                let danioBase = atacante.ataque;
                let multiplicador = 2.0 * multiplicadorPasiva;
                let danio = Math.floor(danioBase * multiplicador);
                let vidaAntes = objetivo.vidaActual;
                let resDanio = this.aplicarDanio(objetivo, danio);
                
                // Mensaje detallado
                let msgDetallado = `🔥 [ULTIMATE] ${atacante.nombre} usa 'Llamarada' contra ${objetivo.nombre}\n`;
                msgDetallado += `   • ATK Base: ${danioBase}\n`;
                msgDetallado += `   • Multiplicador Crítico (200%): ×${multiplicador.toFixed(2)}\n`;
                msgDetallado += `   • Daño Bruto: ${danio}\n`;
                if (resDanio.danioReducidoDefensa > 0) {
                    msgDetallado += `   • Defensa (${resDanio.defensaRival}): -${resDanio.danioReducidoDefensa}\n`;
                }
                if (resDanio.escudoAbsorbido > 0) {
                    msgDetallado += `   • Escudo Absorbió: -${resDanio.escudoAbsorbido}\n`;
                }
                msgDetallado += `   ═══ DAÑO FINAL: ${resDanio.danioReal} ═══\n`;
                msgDetallado += `   ❤️ Vida ${objetivo.nombre}: ${vidaAntes} → ${resDanio.vidaDespues}`;
                if (resDanio.derrotado) msgDetallado += ` 💀`;
                
                resultado.efectos.push({
                    tipo: "critico_garantizado",
                    objetivo: objetivo.nombre,
                    indice: indiceObjetivo,
                    danio: resDanio.danioReal,
                    danioOriginal: resDanio.danioOriginal,
                    danioReducidoDefensa: resDanio.danioReducidoDefensa,
                    escudoAbsorbido: resDanio.escudoAbsorbido,
                    critico: true,
                    vidaAntes: vidaAntes,
                    vidaRestante: objetivo.vidaActual,
                    derrotado: objetivo.estado === "derrotado",
                    revivido: resDanio.revivido,
                    mensaje: msgDetallado
                });
                break;
            }
            
            // Escorpión - Aguijón: 150% daño ignora escudos y buffs de defensa
            case "dmg_piercing_full": {
                if (!objetivo || objetivo.estado === "derrotado") {
                    return { error: true, mensaje: "Objetivo inválido" };
                }
                let escudoDestruido = objetivo.escudo || 0;
                objetivo.escudo = 0;
                if (objetivo.buffs) {
                    objetivo.buffs = objetivo.buffs.filter(b => !b.tipo.includes("def"));
                }
                let danioBase = atacante.ataque;
                let multiplicador = 1.5 * multiplicadorPasiva;
                let danio = Math.floor(danioBase * multiplicador);
                let vidaAntes = objetivo.vidaActual;
                let resDanio = this.aplicarDanioDirecto(objetivo, danio);
                
                let msgDetallado = `🦂 [ULTIMATE] ${atacante.nombre} usa 'Aguijón' contra ${objetivo.nombre}\n`;
                msgDetallado += `   • ATK Base: ${danioBase}\n`;
                msgDetallado += `   • Multiplicador (150%): ×${multiplicador.toFixed(2)}\n`;
                if (escudoDestruido > 0) {
                    msgDetallado += `   • Escudo Destruido: ${escudoDestruido}\n`;
                }
                msgDetallado += `   ⚡ Daño Directo (ignora DEF): ${resDanio.danioReal}\n`;
                msgDetallado += `   ❤️ Vida: ${vidaAntes} → ${resDanio.vidaDespues}`;
                if (resDanio.derrotado) msgDetallado += ` 💀`;
                
                resultado.efectos.push({
                    tipo: "danio_perforante_total",
                    objetivo: objetivo.nombre,
                    indice: indiceObjetivo,
                    danio: resDanio.danioReal,
                    vidaAntes: vidaAntes,
                    vidaRestante: objetivo.vidaActual,
                    derrotado: objetivo.estado === "derrotado",
                    revivido: resDanio.revivido,
                    mensaje: msgDetallado
                });
                break;
            }
            
            // Centauro - Estampida: AoE 60% daño a todos
            case "aoe_60": {
                let danioBase = Math.floor(atacante.ataque * 0.6 * multiplicadorPasiva);
                let objetivosAfectados = [];
                
                equipoRival.forEach((enemigo, idx) => {
                    if (enemigo.estado !== "derrotado") {
                        let vidaAntes = enemigo.vidaActual;
                        let resDanio = this.aplicarDanio(enemigo, danioBase);
                        objetivosAfectados.push({
                            nombre: enemigo.nombre,
                            vidaAntes: vidaAntes,
                            vidaDespues: resDanio.vidaDespues,
                            danio: resDanio.danioReal,
                            derrotado: resDanio.derrotado
                        });
                        resultado.efectos.push({
                            tipo: "aoe_danio",
                            objetivo: enemigo.nombre,
                            indice: idx,
                            danio: resDanio.danioReal,
                            vidaAntes: vidaAntes,
                            vidaRestante: enemigo.vidaActual,
                            derrotado: enemigo.estado === "derrotado",
                            revivido: resDanio.revivido
                        });
                    }
                });
                
                // Mensaje detallado AOE
                let msgAoe = `🐴 [ULTIMATE] ${atacante.nombre} usa 'Estampida' (AoE 60%)\n`;
                msgAoe += `   • ATK Base: ${atacante.ataque} × 0.6 = ${danioBase}\n`;
                msgAoe += `   ─── Impactos ───\n`;
                objetivosAfectados.forEach(obj => {
                    msgAoe += `   • ${obj.nombre}: ${obj.vidaAntes} → ${obj.vidaDespues} (-${obj.danio})${obj.derrotado ? ' 💀' : ''}\n`;
                });
                resultado.mensajeAoe = msgAoe;
                break;
            }
            
            // Ifrit - Infierno: 300% daño + quemadura grave 10%/turno
            case "dmg_300_burn_grave": {
                if (!objetivo || objetivo.estado === "derrotado") {
                    return { error: true, mensaje: "Objetivo inválido" };
                }
                let danioBase = atacante.ataque;
                let multiplicador = 3.0 * multiplicadorPasiva;
                let danio = Math.floor(danioBase * multiplicador);
                let vidaAntes = objetivo.vidaActual;
                let resDanio = this.aplicarDanio(objetivo, danio);
                objetivo.estados = objetivo.estados || [];
                let danioQuemadura = Math.floor(objetivo.vida * 0.10);
                objetivo.estados.push({ tipo: "quemado_grave", duracion: 3, danioPorTurno: danioQuemadura });
                
                let msgDetallado = `🔥🔥 [ULTIMATE] ${atacante.nombre} usa 'Infierno' contra ${objetivo.nombre}\n`;
                msgDetallado += `   • ATK Base: ${danioBase}\n`;
                msgDetallado += `   • Multiplicador (300%): ×${multiplicador.toFixed(2)}\n`;
                msgDetallado += `   • Daño Bruto: ${danio}\n`;
                if (resDanio.danioReducidoDefensa > 0) {
                    msgDetallado += `   • Defensa (${resDanio.defensaRival}): -${resDanio.danioReducidoDefensa}\n`;
                }
                msgDetallado += `   ═══ DAÑO FINAL: ${resDanio.danioReal} ═══\n`;
                msgDetallado += `   ❤️ Vida: ${vidaAntes} → ${resDanio.vidaDespues}${resDanio.derrotado ? ' 💀' : ''}\n`;
                msgDetallado += `   🔥 Quemadura Grave aplicada (${danioQuemadura}/turno × 3 turnos)`;
                
                resultado.efectos.push({
                    tipo: "infierno",
                    objetivo: objetivo.nombre,
                    indice: indiceObjetivo,
                    danio: resDanio.danioReal,
                    estadoAplicado: "quemado_grave",
                    vidaAntes: vidaAntes,
                    vidaRestante: objetivo.vidaActual,
                    derrotado: objetivo.estado === "derrotado",
                    revivido: resDanio.revivido,
                    mensaje: msgDetallado
                });
                break;
            }
            
            // Dragón Rojo - Aliento: AoE 120% daño a todos
            case "aoe_120": {
                let danioBase = Math.floor(atacante.ataque * 1.2 * multiplicadorPasiva);
                let objetivosAfectados = [];
                
                equipoRival.forEach((enemigo, idx) => {
                    if (enemigo.estado !== "derrotado") {
                        let vidaAntes = enemigo.vidaActual;
                        let resDanio = this.aplicarDanio(enemigo, danioBase);
                        objetivosAfectados.push({
                            nombre: enemigo.nombre,
                            vidaAntes: vidaAntes,
                            vidaDespues: resDanio.vidaDespues,
                            danio: resDanio.danioReal,
                            derrotado: resDanio.derrotado
                        });
                        resultado.efectos.push({
                            tipo: "aoe_aliento",
                            objetivo: enemigo.nombre,
                            indice: idx,
                            danio: resDanio.danioReal,
                            vidaAntes: vidaAntes,
                            vidaRestante: enemigo.vidaActual,
                            derrotado: enemigo.estado === "derrotado",
                            revivido: resDanio.revivido
                        });
                    }
                });
                
                let msgAoe = `🐉 [ULTIMATE] ${atacante.nombre} usa 'Aliento de Dragón' (AoE 120%)\n`;
                msgAoe += `   • ATK Base: ${atacante.ataque} × 1.2 = ${danioBase}\n`;
                msgAoe += `   ─── Impactos ───\n`;
                objetivosAfectados.forEach(obj => {
                    msgAoe += `   • ${obj.nombre}: ${obj.vidaAntes} → ${obj.vidaDespues} (-${obj.danio})${obj.derrotado ? ' 💀' : ''}\n`;
                });
                resultado.mensajeAoe = msgAoe;
                break;
            }
            
            // Surtur - Ragnarok: 350% daño, si mata +2 maná
            case "nuke_350_refund": {
                if (!objetivo || objetivo.estado === "derrotado") {
                    return { error: true, mensaje: "Objetivo inválido" };
                }
                let danioBase = atacante.ataque;
                let multiplicador = 3.5 * multiplicadorPasiva;
                let danio = Math.floor(danioBase * multiplicador);
                let vidaAntes = objetivo.vidaActual;
                let resDanio = this.aplicarDanio(objetivo, danio);
                let mato = objetivo.estado === "derrotado" && !resDanio.revivido;
                let manaAntes = atacante.mana;
                if (mato) {
                    atacante.mana = Math.min(atacante.mana + 2, atacante.manaMax);
                }
                
                let msgDetallado = `⚔️ [ULTIMATE] ${atacante.nombre} usa 'Ragnarök' contra ${objetivo.nombre}\n`;
                msgDetallado += `   • ATK Base: ${danioBase}\n`;
                msgDetallado += `   • Multiplicador (350%): ×${multiplicador.toFixed(2)}\n`;
                msgDetallado += `   • Daño Bruto: ${danio}\n`;
                if (resDanio.danioReducidoDefensa > 0) {
                    msgDetallado += `   • Defensa (${resDanio.defensaRival}): -${resDanio.danioReducidoDefensa}\n`;
                }
                msgDetallado += `   ═══ DAÑO FINAL: ${resDanio.danioReal} ═══\n`;
                msgDetallado += `   ❤️ Vida: ${vidaAntes} → ${resDanio.vidaDespues}`;
                if (mato) {
                    msgDetallado += ` 💀\n`;
                    msgDetallado += `   💎 ¡ASESINATO! Maná: ${manaAntes} → ${atacante.mana} (+2)`;
                }
                
                resultado.efectos.push({
                    tipo: "ragnarok",
                    objetivo: objetivo.nombre,
                    indice: indiceObjetivo,
                    danio: resDanio.danioReal,
                    vidaAntes: vidaAntes,
                    vidaRestante: objetivo.vidaActual,
                    derrotado: mato,
                    revivido: resDanio.revivido,
                    manaRecuperado: mato ? 2 : 0,
                    mensaje: msgDetallado
                });
                break;
            }
            
            // ==================== 💧 AGUA ULTIMATES ====================
            // Hipocampo - Chorro: 120% daño + ceguera (-30% precisión, 2 turnos)
            case "dmg_120_blind": {
                if (!objetivo || objetivo.estado === "derrotado") {
                    return { error: true, mensaje: "Objetivo inválido" };
                }
                let danioBase = atacante.ataque;
                let multiplicador = 1.2 * multiplicadorPasiva;
                let danio = Math.floor(danioBase * multiplicador);
                let vidaAntes = objetivo.vidaActual;
                let resDanio = this.aplicarDanio(objetivo, danio);
                objetivo.estados = objetivo.estados || [];
                objetivo.estados.push({ tipo: "cegado", duracion: 2, reduccionPrecision: 0.30 });
                
                let msgDetallado = `💧 [ULTIMATE] ${atacante.nombre} usa 'Chorro' contra ${objetivo.nombre}\n`;
                msgDetallado += `   • ATK Base: ${danioBase}\n`;
                msgDetallado += `   • Multiplicador (120%): ×${multiplicador.toFixed(2)}\n`;
                if (resDanio.danioReducidoDefensa > 0) {
                    msgDetallado += `   • Defensa (${resDanio.defensaRival}): -${resDanio.danioReducidoDefensa}\n`;
                }
                msgDetallado += `   ═══ DAÑO FINAL: ${resDanio.danioReal} ═══\n`;
                msgDetallado += `   ❤️ Vida: ${vidaAntes} → ${resDanio.vidaDespues}${resDanio.derrotado ? ' 💀' : ''}\n`;
                msgDetallado += `   👁️ Ceguera aplicada (-30% precisión × 2 turnos)`;
                
                resultado.efectos.push({
                    tipo: "danio_ceguera",
                    objetivo: objetivo.nombre,
                    indice: indiceObjetivo,
                    danio: resDanio.danioReal,
                    cegado: true,
                    vidaAntes: vidaAntes,
                    vidaRestante: objetivo.vidaActual,
                    derrotado: objetivo.estado === "derrotado",
                    revivido: resDanio.revivido,
                    mensaje: msgDetallado
                });
                break;
            }
            
            // Medusa - Mirada Pétrea: 100% daño + aturde 1 turno
            case "dmg_100_stun": {
                if (!objetivo || objetivo.estado === "derrotado") {
                    return { error: true, mensaje: "Objetivo inválido" };
                }
                let danioBase = atacante.ataque;
                let multiplicador = 1.0 * multiplicadorPasiva;
                let danio = Math.floor(danioBase * multiplicador);
                let vidaAntes = objetivo.vidaActual;
                let resDanio = this.aplicarDanio(objetivo, danio);
                objetivo.estados = objetivo.estados || [];
                objetivo.estados.push({ tipo: "aturdido", duracion: 2 });
                
                let msgDetallado = `🪨 [ULTIMATE] ${atacante.nombre} usa 'Mirada Pétrea' contra ${objetivo.nombre}\n`;
                msgDetallado += `   • ATK Base: ${danioBase}\n`;
                msgDetallado += `   • Multiplicador (100%): ×${multiplicador.toFixed(2)}\n`;
                if (resDanio.danioReducidoDefensa > 0) {
                    msgDetallado += `   • Defensa (${resDanio.defensaRival}): -${resDanio.danioReducidoDefensa}\n`;
                }
                msgDetallado += `   ═══ DAÑO FINAL: ${resDanio.danioReal} ═══\n`;
                msgDetallado += `   ❤️ Vida: ${vidaAntes} → ${resDanio.vidaDespues}${resDanio.derrotado ? ' 💀' : ''}\n`;
                msgDetallado += `   💫 ¡PETRIFICADO! (Aturdido 2 turnos)`;
                
                resultado.efectos.push({
                    tipo: "danio_aturdimiento",
                    objetivo: objetivo.nombre,
                    indice: indiceObjetivo,
                    danio: resDanio.danioReal,
                    aturdido: true,
                    vidaAntes: vidaAntes,
                    vidaRestante: objetivo.vidaActual,
                    derrotado: objetivo.estado === "derrotado",
                    revivido: resDanio.revivido,
                    mensaje: msgDetallado
                });
                break;
            }
            
            // Tiburón - Mandíbula: Destruye escudo + 150% daño
            case "shieldbreak_150": {
                if (!objetivo || objetivo.estado === "derrotado") {
                    return { error: true, mensaje: "Objetivo inválido" };
                }
                let escudoRoto = objetivo.escudo || 0;
                objetivo.escudo = 0;
                let danioBase = atacante.ataque;
                let multiplicador = 1.5 * multiplicadorPasiva;
                let danio = Math.floor(danioBase * multiplicador);
                let vidaAntes = objetivo.vidaActual;
                let resDanio = this.aplicarDanio(objetivo, danio);
                
                let msgDetallado = `🦈 [ULTIMATE] ${atacante.nombre} usa 'Mandíbula' contra ${objetivo.nombre}\n`;
                if (escudoRoto > 0) {
                    msgDetallado += `   🛡️ Escudo Destruido: ${escudoRoto}\n`;
                }
                msgDetallado += `   • ATK Base: ${danioBase}\n`;
                msgDetallado += `   • Multiplicador (150%): ×${multiplicador.toFixed(2)}\n`;
                if (resDanio.danioReducidoDefensa > 0) {
                    msgDetallado += `   • Defensa (${resDanio.defensaRival}): -${resDanio.danioReducidoDefensa}\n`;
                }
                msgDetallado += `   ═══ DAÑO FINAL: ${resDanio.danioReal} ═══\n`;
                msgDetallado += `   ❤️ Vida: ${vidaAntes} → ${resDanio.vidaDespues}${resDanio.derrotado ? ' 💀' : ''}`;
                
                resultado.efectos.push({
                    tipo: "rompe_escudo",
                    objetivo: objetivo.nombre,
                    indice: indiceObjetivo,
                    danio: resDanio.danioReal,
                    escudoRoto: escudoRoto,
                    vidaAntes: vidaAntes,
                    vidaRestante: objetivo.vidaActual,
                    derrotado: objetivo.estado === "derrotado",
                    revivido: resDanio.revivido,
                    mensaje: msgDetallado
                });
                break;
            }
            
            // Gigante Escarcha - Avalancha: AoE 80% + 40% prob. congelar
            case "aoe_80_freeze40": {
                let danioBase = Math.floor(atacante.ataque * 0.8 * multiplicadorPasiva);
                let objetivosAfectados = [];
                
                equipoRival.forEach((enemigo, idx) => {
                    if (enemigo.estado !== "derrotado") {
                        let vidaAntes = enemigo.vidaActual;
                        let resDanio = this.aplicarDanio(enemigo, danioBase);
                        let rollCongelar = Math.random();
                        let congelado = rollCongelar < 0.40;
                        if (congelado && enemigo.estado !== "derrotado" && !this.esInmuneAEstado(enemigo, "congelado")) {
                            enemigo.estados = enemigo.estados || [];
                            enemigo.estados.push({ tipo: "congelado", duracion: 2 });
                        }
                        objetivosAfectados.push({
                            nombre: enemigo.nombre,
                            vidaAntes: vidaAntes,
                            vidaDespues: resDanio.vidaDespues,
                            danio: resDanio.danioReal,
                            derrotado: resDanio.derrotado,
                            congelado: congelado,
                            rollCongelar: (rollCongelar * 100).toFixed(1)
                        });
                        resultado.efectos.push({
                            tipo: "aoe_congelacion",
                            objetivo: enemigo.nombre,
                            indice: idx,
                            danio: resDanio.danioReal,
                            congelado: congelado,
                            vidaAntes: vidaAntes,
                            vidaRestante: enemigo.vidaActual,
                            derrotado: enemigo.estado === "derrotado",
                            revivido: resDanio.revivido
                        });
                    }
                });
                
                let msgAoe = `❄️ [ULTIMATE] ${atacante.nombre} usa 'Avalancha' (AoE 80% + 40% congelar)\n`;
                msgAoe += `   • ATK Base: ${atacante.ataque} × 0.8 = ${danioBase}\n`;
                msgAoe += `   ─── Impactos ───\n`;
                objetivosAfectados.forEach(obj => {
                    msgAoe += `   • ${obj.nombre}: ${obj.vidaAntes} → ${obj.vidaDespues} (-${obj.danio})`;
                    msgAoe += obj.derrotado ? ' 💀' : '';
                    msgAoe += ` | Roll: ${obj.rollCongelar}%${obj.congelado ? ' ❄️CONGELADO' : ''}\n`;
                });
                resultado.mensajeAoe = msgAoe;
                break;
            }
            
            // Poseidón - Tridente: 120% daño + cura 20% vida a aliados
            case "dmg_120_heal_team_20": {
                let msgDetallado = `🔱 [ULTIMATE] ${atacante.nombre} usa 'Tridente'\n`;
                
                if (objetivo && objetivo.estado !== "derrotado") {
                    let danioBase = atacante.ataque;
                    let multiplicador = 1.2 * multiplicadorPasiva;
                    let danio = Math.floor(danioBase * multiplicador);
                    let vidaAntes = objetivo.vidaActual;
                    let resDanio = this.aplicarDanio(objetivo, danio);
                    
                    msgDetallado += `   ─── DAÑO ───\n`;
                    msgDetallado += `   • ATK Base: ${danioBase} × 1.2 = ${danio}\n`;
                    if (resDanio.danioReducidoDefensa > 0) {
                        msgDetallado += `   • Defensa: -${resDanio.danioReducidoDefensa}\n`;
                    }
                    msgDetallado += `   ═══ DAÑO FINAL: ${resDanio.danioReal} ═══\n`;
                    msgDetallado += `   ❤️ ${objetivo.nombre}: ${vidaAntes} → ${resDanio.vidaDespues}${resDanio.derrotado ? ' 💀' : ''}\n`;
                    
                    resultado.efectos.push({
                        tipo: "danio",
                        objetivo: objetivo.nombre,
                        indice: indiceObjetivo,
                        danio: resDanio.danioReal,
                        vidaAntes: vidaAntes,
                        vidaRestante: objetivo.vidaActual,
                        derrotado: objetivo.estado === "derrotado",
                        revivido: resDanio.revivido
                    });
                }
                
                // Curar 20% vida a cada aliado
                msgDetallado += `   ─── CURACIÓN (20% vida máx.) ───\n`;
                equipoAliado.forEach((aliado, idx) => {
                    if (aliado.estado !== "derrotado") {
                        let curacion = Math.floor(aliado.vida * 0.20);
                        let vidaAntes = aliado.vidaActual;
                        let curacionReal = Math.min(curacion, aliado.vida - aliado.vidaActual);
                        aliado.vidaActual += curacionReal;
                        msgDetallado += `   💚 ${aliado.nombre}: ${vidaAntes} → ${aliado.vidaActual} (+${curacionReal})\n`;
                        if (curacionReal > 0) {
                            resultado.efectos.push({
                                tipo: "curacion",
                                objetivo: aliado.nombre,
                                indice: idx,
                                curacion: curacionReal,
                                vidaAntes: vidaAntes,
                                vidaActual: aliado.vidaActual
                            });
                        }
                    }
                });
                
                resultado.efectos.push({ tipo: "mensajeCompleto", mensaje: msgDetallado });
                break;
            }
            
            // Leviatán - Tsunami: AoE 100% daño + purga buffs enemigos
            case "aoe_100_purge": {
                let danioBase = Math.floor(atacante.ataque * 1.0 * multiplicadorPasiva);
                let objetivosAfectados = [];
                
                equipoRival.forEach((enemigo, idx) => {
                    if (enemigo.estado !== "derrotado") {
                        let vidaAntes = enemigo.vidaActual;
                        let buffsAntes = (enemigo.buffs || []).length;
                        let escudoAntes = enemigo.escudo || 0;
                        let resDanio = this.aplicarDanio(enemigo, danioBase);
                        enemigo.buffs = [];
                        enemigo.escudo = 0;
                        objetivosAfectados.push({
                            nombre: enemigo.nombre,
                            vidaAntes: vidaAntes,
                            vidaDespues: resDanio.vidaDespues,
                            danio: resDanio.danioReal,
                            derrotado: resDanio.derrotado,
                            buffsPurgados: buffsAntes,
                            escudoPurgado: escudoAntes
                        });
                        resultado.efectos.push({
                            tipo: "aoe_purga",
                            objetivo: enemigo.nombre,
                            indice: idx,
                            danio: resDanio.danioReal,
                            buffsEliminados: true,
                            vidaAntes: vidaAntes,
                            vidaRestante: enemigo.vidaActual,
                            derrotado: enemigo.estado === "derrotado",
                            revivido: resDanio.revivido
                        });
                    }
                });
                
                let msgAoe = `🌊 [ULTIMATE] ${atacante.nombre} usa 'Tsunami' (AoE 100% + Purga)\n`;
                msgAoe += `   • ATK Base: ${atacante.ataque} × 1.0 = ${danioBase}\n`;
                msgAoe += `   ─── Impactos ───\n`;
                objetivosAfectados.forEach(obj => {
                    msgAoe += `   • ${obj.nombre}: ${obj.vidaAntes} → ${obj.vidaDespues} (-${obj.danio})${obj.derrotado ? ' 💀' : ''}`;
                    if (obj.buffsPurgados > 0 || obj.escudoPurgado > 0) {
                        msgAoe += ` | Purgado: ${obj.buffsPurgados} buffs, ${obj.escudoPurgado} escudo`;
                    }
                    msgAoe += '\n';
                });
                resultado.mensajeAoe = msgAoe;
                break;
            }
            
            // ==================== 🪨 TIERRA ULTIMATES ====================
            // Ent - Corteza: Escudo del 50% de tu vida máxima
            case "shield_50": {
                let escudoAntes = atacante.escudo || 0;
                let escudo = Math.floor(atacante.vida * 0.5);
                atacante.escudo = escudoAntes + escudo;
                
                let msgDetallado = `🛡️ [ULTIMATE] ${atacante.nombre} usa 'Corteza'\n`;
                msgDetallado += `   • Vida Máxima: ${atacante.vida}\n`;
                msgDetallado += `   • Escudo (50%): +${escudo}\n`;
                msgDetallado += `   ═══ Escudo: ${escudoAntes} → ${atacante.escudo} ═══`;
                
                resultado.efectos.push({
                    tipo: "escudo_grande",
                    objetivo: atacante.nombre,
                    indice: indiceAtacante,
                    escudo: escudo,
                    escudoAntes: escudoAntes,
                    escudoTotal: atacante.escudo,
                    mensaje: msgDetallado
                });
                break;
            }
            
            // Lobo - Aullido: +20% Ataque a todo el equipo por 3 turnos
            case "buff_atk_team_20": {
                let msgDetallado = `🐺 [ULTIMATE] ${atacante.nombre} usa 'Aullido'\n`;
                msgDetallado += `   ─── Buffs de Ataque (+20%) ───\n`;
                
                equipoAliado.forEach((aliado, idx) => {
                    if (aliado.estado !== "derrotado") {
                        let ataqueAntes = aliado.ataque;
                        let bonus = Math.floor(aliado.ataque * 0.2);
                        aliado.ataque += bonus;
                        aliado.buffs = aliado.buffs || [];
                        aliado.buffs.push({ tipo: "ataque", valor: bonus, duracion: 3 });
                        msgDetallado += `   ⚔️ ${aliado.nombre}: ATK ${ataqueAntes} → ${aliado.ataque} (+${bonus}) × 3 turnos\n`;
                        resultado.efectos.push({
                            tipo: "buff_ataque",
                            objetivo: aliado.nombre,
                            indice: idx,
                            ataqueAntes: ataqueAntes,
                            bonusAtaque: bonus,
                            ataqueDespues: aliado.ataque
                        });
                    }
                });
                
                resultado.efectos.push({ tipo: "mensajeCompleto", mensaje: msgDetallado });
                break;
            }
            
            // Minotauro - Seísmo: 130% daño + -50% defensa 2 turnos
            case "dmg_130_armor_break": {
                if (!objetivo || objetivo.estado === "derrotado") {
                    return { error: true, mensaje: "Objetivo inválido" };
                }
                let danioBase = atacante.ataque;
                let multiplicador = 1.3 * multiplicadorPasiva;
                let danio = Math.floor(danioBase * multiplicador);
                let vidaAntes = objetivo.vidaActual;
                let resDanio = this.aplicarDanio(objetivo, danio);
                let defensaAntes = objetivo.defensa;
                let defensaReducida = Math.floor(objetivo.defensa * 0.5);
                objetivo.defensa = Math.max(1, objetivo.defensa - defensaReducida);
                objetivo.estados = objetivo.estados || [];
                objetivo.estados.push({ tipo: "defensa_rota", duracion: 2 });
                
                let msgDetallado = `🐂 [ULTIMATE] ${atacante.nombre} usa 'Seísmo' contra ${objetivo.nombre}\n`;
                msgDetallado += `   • ATK Base: ${danioBase}\n`;
                msgDetallado += `   • Multiplicador (130%): ×${multiplicador.toFixed(2)}\n`;
                if (resDanio.danioReducidoDefensa > 0) {
                    msgDetallado += `   • Defensa (${resDanio.defensaRival}): -${resDanio.danioReducidoDefensa}\n`;
                }
                msgDetallado += `   ═══ DAÑO FINAL: ${resDanio.danioReal} ═══\n`;
                msgDetallado += `   ❤️ Vida: ${vidaAntes} → ${resDanio.vidaDespues}${resDanio.derrotado ? ' 💀' : ''}\n`;
                msgDetallado += `   💥 Defensa Rota: ${defensaAntes} → ${objetivo.defensa} (-${defensaReducida}) × 2 turnos`;
                
                resultado.efectos.push({
                    tipo: "danio_rompe_defensa",
                    objetivo: objetivo.nombre,
                    indice: indiceObjetivo,
                    danio: resDanio.danioReal,
                    defensaAntes: defensaAntes,
                    defensaReducida: defensaReducida,
                    nuevaDefensa: objetivo.defensa,
                    vidaAntes: vidaAntes,
                    vidaRestante: objetivo.vidaActual,
                    derrotado: objetivo.estado === "derrotado",
                    revivido: resDanio.revivido,
                    mensaje: msgDetallado
                });
                break;
            }
            
            // Gólem - Aplastar: Daño = 250% de tu DEFENSA
            case "dmg_def_250": {
                if (!objetivo || objetivo.estado === "derrotado") {
                    return { error: true, mensaje: "Objetivo inválido" };
                }
                let defensa = atacante.defensa;
                let multiplicador = 2.5 * multiplicadorPasiva;
                let danio = Math.floor(defensa * multiplicador);
                let vidaAntes = objetivo.vidaActual;
                let resDanio = this.aplicarDanio(objetivo, danio);
                
                let msgDetallado = `🪨 [ULTIMATE] ${atacante.nombre} usa 'Aplastar' contra ${objetivo.nombre}\n`;
                msgDetallado += `   ⚠️ DAÑO BASADO EN DEFENSA\n`;
                msgDetallado += `   • DEF Base: ${defensa}\n`;
                msgDetallado += `   • Multiplicador (250%): ×${multiplicador.toFixed(2)}\n`;
                msgDetallado += `   • Daño Bruto: ${danio}\n`;
                if (resDanio.danioReducidoDefensa > 0) {
                    msgDetallado += `   • Defensa Rival (${resDanio.defensaRival}): -${resDanio.danioReducidoDefensa}\n`;
                }
                msgDetallado += `   ═══ DAÑO FINAL: ${resDanio.danioReal} ═══\n`;
                msgDetallado += `   ❤️ Vida: ${vidaAntes} → ${resDanio.vidaDespues}${resDanio.derrotado ? ' 💀' : ''}`;
                
                resultado.efectos.push({
                    tipo: "aplastamiento",
                    objetivo: objetivo.nombre,
                    indice: indiceObjetivo,
                    danio: resDanio.danioReal,
                    basadoEnDefensa: true,
                    defensaUsada: defensa,
                    vidaAntes: vidaAntes,
                    vidaRestante: objetivo.vidaActual,
                    derrotado: objetivo.estado === "derrotado",
                    revivido: resDanio.revivido,
                    mensaje: msgDetallado
                });
                break;
            }
            
            // Gárgola - Derrumbe: 3 ataques de 100% a objetivos aleatorios
            case "dmg_triple_random": {
                let msgDetallado = `🗿 [ULTIMATE] ${atacante.nombre} usa 'Derrumbe' (3 ataques aleatorios)\n`;
                msgDetallado += `   • ATK Base: ${atacante.ataque} × 1.0 = ${Math.floor(atacante.ataque * multiplicadorPasiva)}\n`;
                msgDetallado += `   ─── Impactos ───\n`;
                
                let objetivosVivos = equipoRival.filter(e => e.estado !== "derrotado");
                for (let i = 0; i < 3 && objetivosVivos.length > 0; i++) {
                    let objetivoRandom = objetivosVivos[Math.floor(Math.random() * objetivosVivos.length)];
                    let idx = equipoRival.indexOf(objetivoRandom);
                    let danio = Math.floor(atacante.ataque * 1.0 * multiplicadorPasiva);
                    let vidaAntes = objetivoRandom.vidaActual;
                    let resDanio = this.aplicarDanio(objetivoRandom, danio);
                    
                    msgDetallado += `   [${i+1}] ${objetivoRandom.nombre}: ${vidaAntes} → ${resDanio.vidaDespues} (-${resDanio.danioReal})${resDanio.derrotado ? ' 💀' : ''}\n`;
                    
                    resultado.efectos.push({
                        tipo: "danio_aleatorio",
                        objetivo: objetivoRandom.nombre,
                        indice: idx,
                        danio: resDanio.danioReal,
                        vidaAntes: vidaAntes,
                        vidaRestante: objetivoRandom.vidaActual,
                        derrotado: objetivoRandom.estado === "derrotado",
                        revivido: resDanio.revivido
                    });
                    objetivosVivos = equipoRival.filter(e => e.estado !== "derrotado");
                }
                
                resultado.efectos.push({ tipo: "mensajeCompleto", mensaje: msgDetallado });
                break;
            }
            
            // Behemoth - Devorar: 150% daño + robo vida 100%
            case "lifesteal_150": {
                if (!objetivo || objetivo.estado === "derrotado") {
                    return { error: true, mensaje: "Objetivo inválido" };
                }
                let danioBase = atacante.ataque;
                let multiplicador = 1.5 * multiplicadorPasiva;
                let danio = Math.floor(danioBase * multiplicador);
                let vidaAntes = objetivo.vidaActual;
                let vidaAtacanteAntes = atacante.vidaActual;
                let resDanio = this.aplicarDanio(objetivo, danio);
                let curacion = resDanio.danioReal; // 100% lifesteal
                atacante.vidaActual = Math.min(atacante.vidaActual + curacion, atacante.vida);
                
                let msgDetallado = `🍖 [ULTIMATE] ${atacante.nombre} usa 'Devorar' contra ${objetivo.nombre}\n`;
                msgDetallado += `   • ATK Base: ${danioBase}\n`;
                msgDetallado += `   • Multiplicador (150%): ×${multiplicador.toFixed(2)}\n`;
                if (resDanio.danioReducidoDefensa > 0) {
                    msgDetallado += `   • Defensa (${resDanio.defensaRival}): -${resDanio.danioReducidoDefensa}\n`;
                }
                msgDetallado += `   ═══ DAÑO FINAL: ${resDanio.danioReal} ═══\n`;
                msgDetallado += `   ❤️ ${objetivo.nombre}: ${vidaAntes} → ${resDanio.vidaDespues}${resDanio.derrotado ? ' 💀' : ''}\n`;
                msgDetallado += `   ─── ROBO DE VIDA (100%) ───\n`;
                msgDetallado += `   💚 ${atacante.nombre}: ${vidaAtacanteAntes} → ${atacante.vidaActual} (+${curacion})`;
                
                resultado.efectos.push({
                    tipo: "devorar",
                    objetivo: objetivo.nombre,
                    indice: indiceObjetivo,
                    danio: resDanio.danioReal,
                    vidaRobada: curacion,
                    vidaAntes: vidaAntes,
                    vidaAtacanteAntes: vidaAtacanteAntes,
                    vidaRestanteAtacante: atacante.vidaActual,
                    vidaRestante: objetivo.vidaActual,
                    derrotado: objetivo.estado === "derrotado",
                    revivido: resDanio.revivido,
                    mensaje: msgDetallado
                });
                break;
            }
            
            // ==================== 🌪️ AIRE ULTIMATES ====================
            // Águila - Picada: Crítico garantizado 150% daño
            case "crit_150": {
                if (!objetivo || objetivo.estado === "derrotado") {
                    return { error: true, mensaje: "Objetivo inválido" };
                }
                let danioBase = atacante.ataque;
                let multiplicador = 1.5 * multiplicadorPasiva;
                let danio = Math.floor(danioBase * multiplicador);
                let vidaAntes = objetivo.vidaActual;
                let resDanio = this.aplicarDanio(objetivo, danio);
                
                let msgDetallado = `🦅 [ULTIMATE] ${atacante.nombre} usa 'Picada' contra ${objetivo.nombre}\n`;
                msgDetallado += `   • ATK Base: ${danioBase}\n`;
                msgDetallado += `   • Multiplicador Crítico (150%): ×${multiplicador.toFixed(2)}\n`;
                if (resDanio.danioReducidoDefensa > 0) {
                    msgDetallado += `   • Defensa (${resDanio.defensaRival}): -${resDanio.danioReducidoDefensa}\n`;
                }
                msgDetallado += `   ═══ DAÑO FINAL: ${resDanio.danioReal} ═══\n`;
                msgDetallado += `   ❤️ Vida: ${vidaAntes} → ${resDanio.vidaDespues}${resDanio.derrotado ? ' 💀' : ''}`;
                
                resultado.efectos.push({
                    tipo: "critico",
                    objetivo: objetivo.nombre,
                    indice: indiceObjetivo,
                    danio: resDanio.danioReal,
                    critico: true,
                    vidaAntes: vidaAntes,
                    vidaRestante: objetivo.vidaActual,
                    derrotado: objetivo.estado === "derrotado",
                    revivido: resDanio.revivido,
                    mensaje: msgDetallado
                });
                break;
            }
            
            // Mantaraya - Electroshock: 2x110% daño a 2 enemigos aleatorios
            case "dmg_110_x2": {
                let msgDetallado = `⚡ [ULTIMATE] ${atacante.nombre} usa 'Electroshock' (2 objetivos, 110%)\n`;
                let objetivosVivos = equipoRival.filter(e => e.estado !== "derrotado");
                let danio = Math.floor(atacante.ataque * 1.1 * multiplicadorPasiva);
                msgDetallado += `   • ATK Base: ${atacante.ataque} × 1.1 = ${danio}\n`;
                msgDetallado += `   ─── Impactos ───\n`;
                
                let hits = Math.min(2, objetivosVivos.length);
                for (let i = 0; i < hits; i++) {
                    let objetivoRandom = objetivosVivos[Math.floor(Math.random() * objetivosVivos.length)];
                    let idx = equipoRival.indexOf(objetivoRandom);
                    let vidaAntes = objetivoRandom.vidaActual;
                    let resDanio = this.aplicarDanio(objetivoRandom, danio);
                    
                    msgDetallado += `   [${i+1}] ${objetivoRandom.nombre}: ${vidaAntes} → ${resDanio.vidaDespues} (-${resDanio.danioReal})${resDanio.derrotado ? ' 💀' : ''}\n`;
                    
                    resultado.efectos.push({
                        tipo: "electroshock",
                        objetivo: objetivoRandom.nombre,
                        indice: idx,
                        danio: resDanio.danioReal,
                        vidaAntes: vidaAntes,
                        vidaRestante: objetivoRandom.vidaActual,
                        derrotado: objetivoRandom.estado === "derrotado",
                        revivido: resDanio.revivido
                    });
                    objetivosVivos = equipoRival.filter(e => e.estado !== "derrotado");
                    if (objetivosVivos.length === 0) break;
                }
                
                resultado.efectos.push({ tipo: "mensajeCompleto", mensaje: msgDetallado });
                break;
            }
            
            // Grifo - Vendaval: 120% daño + obliga cambio de personaje
            case "dmg_120_swap": {
                if (!objetivo || objetivo.estado === "derrotado") {
                    return { error: true, mensaje: "Objetivo inválido" };
                }
                let danioBase = atacante.ataque;
                let multiplicador = 1.2 * multiplicadorPasiva;
                let danio = Math.floor(danioBase * multiplicador);
                let vidaAntes = objetivo.vidaActual;
                let resDanio = this.aplicarDanio(objetivo, danio);
                resultado.forzarCambio = true;
                
                let msgDetallado = `🌪️ [ULTIMATE] ${atacante.nombre} usa 'Vendaval' contra ${objetivo.nombre}\n`;
                msgDetallado += `   • ATK Base: ${danioBase}\n`;
                msgDetallado += `   • Multiplicador (120%): ×${multiplicador.toFixed(2)}\n`;
                if (resDanio.danioReducidoDefensa > 0) {
                    msgDetallado += `   • Defensa (${resDanio.defensaRival}): -${resDanio.danioReducidoDefensa}\n`;
                }
                msgDetallado += `   ═══ DAÑO FINAL: ${resDanio.danioReal} ═══\n`;
                msgDetallado += `   ❤️ Vida: ${vidaAntes} → ${resDanio.vidaDespues}${resDanio.derrotado ? ' 💀' : ''}\n`;
                msgDetallado += `   🔄 ¡FORZADO A CAMBIAR DE PERSONAJE!`;
                
                resultado.efectos.push({
                    tipo: "vendaval",
                    objetivo: objetivo.nombre,
                    indice: indiceObjetivo,
                    danio: resDanio.danioReal,
                    forzarCambio: true,
                    vidaAntes: vidaAntes,
                    vidaRestante: objetivo.vidaActual,
                    derrotado: objetivo.estado === "derrotado",
                    revivido: resDanio.revivido,
                    mensaje: msgDetallado
                });
                break;
            }
            
            // Thunderbird - Tormenta: AoE 80% + 30% prob. paralizar
            case "aoe_80_paralyze30": {
                let danioBase = Math.floor(atacante.ataque * 0.8 * multiplicadorPasiva);
                let objetivosAfectados = [];
                
                equipoRival.forEach((enemigo, idx) => {
                    if (enemigo.estado !== "derrotado") {
                        let vidaAntes = enemigo.vidaActual;
                        let resDanio = this.aplicarDanio(enemigo, danioBase);
                        let rollParalizar = Math.random();
                        let paralizado = rollParalizar < 0.30;
                        if (paralizado && enemigo.estado !== "derrotado" && !this.esInmuneAEstado(enemigo, "paralizado")) {
                            enemigo.estados = enemigo.estados || [];
                            enemigo.estados.push({ tipo: "paralizado", duracion: 2 });
                        }
                        objetivosAfectados.push({
                            nombre: enemigo.nombre,
                            vidaAntes: vidaAntes,
                            vidaDespues: resDanio.vidaDespues,
                            danio: resDanio.danioReal,
                            derrotado: resDanio.derrotado,
                            paralizado: paralizado,
                            rollParalizar: (rollParalizar * 100).toFixed(1)
                        });
                        resultado.efectos.push({
                            tipo: "aoe_paralisis",
                            objetivo: enemigo.nombre,
                            indice: idx,
                            danio: resDanio.danioReal,
                            paralizado: paralizado,
                            vidaAntes: vidaAntes,
                            vidaRestante: enemigo.vidaActual,
                            derrotado: enemigo.estado === "derrotado",
                            revivido: resDanio.revivido
                        });
                    }
                });
                
                let msgAoe = `⚡ [ULTIMATE] ${atacante.nombre} usa 'Tormenta' (AoE 80% + 30% paralizar)\n`;
                msgAoe += `   • ATK Base: ${atacante.ataque} × 0.8 = ${danioBase}\n`;
                msgAoe += `   ─── Impactos ───\n`;
                objetivosAfectados.forEach(obj => {
                    msgAoe += `   • ${obj.nombre}: ${obj.vidaAntes} → ${obj.vidaDespues} (-${obj.danio})`;
                    msgAoe += obj.derrotado ? ' 💀' : '';
                    msgAoe += ` | Roll: ${obj.rollParalizar}%${obj.paralizado ? ' ⚡PARALIZADO' : ''}\n`;
                });
                resultado.mensajeAoe = msgAoe;
                break;
            }
            
            // Guardián Aéreo - Muro de Viento: Equipo INVULNERABLE 1 turno
            case "team_invuln": {
                let msgDetallado = `🛡️ [ULTIMATE] ${atacante.nombre} usa 'Muro de Viento'\n`;
                msgDetallado += `   ═══ INVULNERABILIDAD (1 turno) ═══\n`;
                
                equipoAliado.forEach((aliado, idx) => {
                    if (aliado.estado !== "derrotado") {
                        aliado.estados = aliado.estados || [];
                        aliado.estados.push({ tipo: "invulnerable", duracion: 1 });
                        msgDetallado += `   ✨ ${aliado.nombre} es INVULNERABLE\n`;
                        resultado.efectos.push({
                            tipo: "invulnerabilidad",
                            objetivo: aliado.nombre,
                            indice: idx
                        });
                    }
                });
                
                resultado.efectos.push({ tipo: "mensajeCompleto", mensaje: msgDetallado });
                break;
            }
            
            // Zephyr - Huracán: AoE 90% daño + -1 maná por enemigo
            case "aoe_90_mana_drain": {
                let danioBase = Math.floor(atacante.ataque * 0.9 * multiplicadorPasiva);
                let objetivosAfectados = [];
                
                equipoRival.forEach((enemigo, idx) => {
                    if (enemigo.estado !== "derrotado") {
                        let vidaAntes = enemigo.vidaActual;
                        let manaAntes = enemigo.mana;
                        let resDanio = this.aplicarDanio(enemigo, danioBase);
                        let manaDrenado = Math.min(1, enemigo.mana);
                        enemigo.mana = Math.max(0, enemigo.mana - 1);
                        objetivosAfectados.push({
                            nombre: enemigo.nombre,
                            vidaAntes: vidaAntes,
                            vidaDespues: resDanio.vidaDespues,
                            danio: resDanio.danioReal,
                            derrotado: resDanio.derrotado,
                            manaAntes: manaAntes,
                            manaDespues: enemigo.mana,
                            manaDrenado: manaDrenado
                        });
                        resultado.efectos.push({
                            tipo: "aoe_robo_mana",
                            objetivo: enemigo.nombre,
                            indice: idx,
                            danio: resDanio.danioReal,
                            manaRobado: manaDrenado,
                            vidaAntes: vidaAntes,
                            vidaRestante: enemigo.vidaActual,
                            derrotado: enemigo.estado === "derrotado",
                            revivido: resDanio.revivido
                        });
                    }
                });
                
                let msgAoe = `🌀 [ULTIMATE] ${atacante.nombre} usa 'Huracán' (AoE 90% + Robo Maná)\n`;
                msgAoe += `   • ATK Base: ${atacante.ataque} × 0.9 = ${danioBase}\n`;
                msgAoe += `   ─── Impactos ───\n`;
                objetivosAfectados.forEach(obj => {
                    msgAoe += `   • ${obj.nombre}: ${obj.vidaAntes} → ${obj.vidaDespues} (-${obj.danio})${obj.derrotado ? ' 💀' : ''}`;
                    if (obj.manaDrenado > 0) {
                        msgAoe += ` | Maná: ${obj.manaAntes} → ${obj.manaDespues}`;
                    }
                    msgAoe += '\n';
                });
                resultado.mensajeAoe = msgAoe;
                break;
            }
            
            // ==================== 🌑 OSCURIDAD ULTIMATES ====================
            // Araña - Veneno Letal: Veneno fuerte 10% vida/turno, 3 turnos
            case "poison_strong": {
                if (!objetivo || objetivo.estado === "derrotado") {
                    return { error: true, mensaje: "Objetivo inválido" };
                }
                objetivo.estados = objetivo.estados || [];
                let danioPorTurno = Math.floor(objetivo.vida * 0.10);
                objetivo.estados.push({ tipo: "envenenado_grave", duracion: 3, danioPorTurno: danioPorTurno });
                
                let msgDetallado = `🕷️ [ULTIMATE] ${atacante.nombre} usa 'Veneno Letal' contra ${objetivo.nombre}\n`;
                msgDetallado += `   • Vida Máxima Objetivo: ${objetivo.vida}\n`;
                msgDetallado += `   • Daño por turno (10%): ${danioPorTurno}\n`;
                msgDetallado += `   ═══ Veneno Grave aplicado (${danioPorTurno}/turno × 3 turnos) ═══\n`;
                msgDetallado += `   ☠️ Daño Total Potencial: ${danioPorTurno * 3}`;
                
                resultado.efectos.push({
                    tipo: "veneno_fuerte",
                    objetivo: objetivo.nombre,
                    indice: indiceObjetivo,
                    danioPorTurno: danioPorTurno,
                    envenenado: true,
                    mensaje: msgDetallado
                });
                break;
            }
            
            // Cofre Mímico - Tragar: Si <50% HP ejecuta, sino 50% daño
            case "execute_50": {
                if (!objetivo || objetivo.estado === "derrotado") {
                    return { error: true, mensaje: "Objetivo inválido" };
                }
                if (this.tieneEstado(objetivo, "invulnerable")) {
                    resultado.efectos.push({
                        tipo: "bloqueado",
                        objetivo: objetivo.nombre,
                        indice: indiceObjetivo,
                        mensaje: `❌ ${objetivo.nombre} es INVULNERABLE - Tragar falló`
                    });
                    break;
                }
                let porcentajeVida = objetivo.vidaActual / objetivo.vida;
                let vidaAntes = objetivo.vidaActual;
                
                if (porcentajeVida < 0.5) {
                    let danio = objetivo.vidaActual;
                    let resDanio = this.aplicarDanioDirecto(objetivo, danio);
                    
                    let msgDetallado = `📦 [ULTIMATE] ${atacante.nombre} usa 'Tragar' contra ${objetivo.nombre}\n`;
                    msgDetallado += `   • Vida Objetivo: ${vidaAntes}/${objetivo.vida} (${(porcentajeVida * 100).toFixed(1)}%)\n`;
                    msgDetallado += `   ⚠️ ¡BAJO 50% HP! → EJECUCIÓN\n`;
                    msgDetallado += `   ═══ DAÑO FINAL: ${resDanio.danioReal} ═══\n`;
                    msgDetallado += `   💀 ${objetivo.nombre} ha sido DEVORADO`;
                    
                    resultado.efectos.push({
                        tipo: "ejecucion",
                        objetivo: objetivo.nombre,
                        indice: indiceObjetivo,
                        danio: resDanio.danioReal,
                        ejecutado: true,
                        vidaAntes: vidaAntes,
                        vidaRestante: objetivo.vidaActual,
                        derrotado: objetivo.estado === "derrotado",
                        revivido: resDanio.revivido,
                        mensaje: msgDetallado
                    });
                } else {
                    let danioBase = atacante.ataque;
                    let multiplicador = 0.5 * multiplicadorPasiva;
                    let danio = Math.floor(danioBase * multiplicador);
                    let resDanio = this.aplicarDanio(objetivo, danio);
                    
                    let msgDetallado = `📦 [ULTIMATE] ${atacante.nombre} usa 'Tragar' contra ${objetivo.nombre}\n`;
                    msgDetallado += `   • Vida Objetivo: ${vidaAntes}/${objetivo.vida} (${(porcentajeVida * 100).toFixed(1)}%)\n`;
                    msgDetallado += `   ℹ️ Sobre 50% HP → Daño normal\n`;
                    msgDetallado += `   • ATK Base: ${danioBase} × 0.5 = ${danio}\n`;
                    if (resDanio.danioReducidoDefensa > 0) {
                        msgDetallado += `   • Defensa: -${resDanio.danioReducidoDefensa}\n`;
                    }
                    msgDetallado += `   ═══ DAÑO FINAL: ${resDanio.danioReal} ═══\n`;
                    msgDetallado += `   ❤️ Vida: ${vidaAntes} → ${resDanio.vidaDespues}${resDanio.derrotado ? ' 💀' : ''}`;
                    
                    resultado.efectos.push({
                        tipo: "danio",
                        objetivo: objetivo.nombre,
                        indice: indiceObjetivo,
                        danio: resDanio.danioReal,
                        ejecutado: false,
                        vidaAntes: vidaAntes,
                        vidaRestante: objetivo.vidaActual,
                        derrotado: objetivo.estado === "derrotado",
                        revivido: resDanio.revivido,
                        mensaje: msgDetallado
                    });
                }
                break;
            }
            
            // Cerbero - Aliento de Hades: 130% daño + anti-heal 3 turnos
            case "dmg_130_curse": {
                if (!objetivo || objetivo.estado === "derrotado") {
                    return { error: true, mensaje: "Objetivo inválido" };
                }
                let danioBase = atacante.ataque;
                let multiplicador = 1.3 * multiplicadorPasiva;
                let danio = Math.floor(danioBase * multiplicador);
                let vidaAntes = objetivo.vidaActual;
                let resDanio = this.aplicarDanio(objetivo, danio);
                objetivo.estados = objetivo.estados || [];
                objetivo.estados.push({ tipo: "anti_curacion", duracion: 3 });
                
                let msgDetallado = `🐕 [ULTIMATE] ${atacante.nombre} usa 'Aliento de Hades' contra ${objetivo.nombre}\n`;
                msgDetallado += `   • ATK Base: ${danioBase}\n`;
                msgDetallado += `   • Multiplicador (130%): ×${multiplicador.toFixed(2)}\n`;
                if (resDanio.danioReducidoDefensa > 0) {
                    msgDetallado += `   • Defensa (${resDanio.defensaRival}): -${resDanio.danioReducidoDefensa}\n`;
                }
                msgDetallado += `   ═══ DAÑO FINAL: ${resDanio.danioReal} ═══\n`;
                msgDetallado += `   ❤️ Vida: ${vidaAntes} → ${resDanio.vidaDespues}${resDanio.derrotado ? ' 💀' : ''}\n`;
                msgDetallado += `   🚫 ANTI-CURACIÓN aplicada (3 turnos)`;
                
                resultado.efectos.push({
                    tipo: "maldicion",
                    objetivo: objetivo.nombre,
                    indice: indiceObjetivo,
                    danio: resDanio.danioReal,
                    antiCuracion: true,
                    vidaAntes: vidaAntes,
                    vidaRestante: objetivo.vidaActual,
                    derrotado: objetivo.estado === "derrotado",
                    revivido: resDanio.revivido,
                    mensaje: msgDetallado
                });
                break;
            }
            
            // Caballero Oscuro - Hoja del Vacío: 150 daño verdadero FIJO
            case "true_dmg_150": {
                if (!objetivo || objetivo.estado === "derrotado") {
                    return { error: true, mensaje: "Objetivo inválido" };
                }
                let vidaAntes = objetivo.vidaActual;
                let danio = 150; // FIJO, no escala
                let resDanio = this.aplicarDanioDirecto(objetivo, danio);
                
                let msgDetallado = `⚔️ [ULTIMATE] ${atacante.nombre} usa 'Hoja del Vacío' contra ${objetivo.nombre}\n`;
                msgDetallado += `   ⚠️ DAÑO VERDADERO FIJO\n`;
                msgDetallado += `   • Daño: 150 (ignora TODO)\n`;
                msgDetallado += `   ═══ DAÑO FINAL: ${resDanio.danioReal} ═══\n`;
                msgDetallado += `   ❤️ Vida: ${vidaAntes} → ${resDanio.vidaDespues}${resDanio.derrotado ? ' 💀' : ''}`;
                
                resultado.efectos.push({
                    tipo: "danio_verdadero",
                    objetivo: objetivo.nombre,
                    indice: indiceObjetivo,
                    danio: resDanio.danioReal,
                    fijo: true,
                    vidaAntes: vidaAntes,
                    vidaRestante: objetivo.vidaActual,
                    derrotado: objetivo.estado === "derrotado",
                    revivido: resDanio.revivido,
                    mensaje: msgDetallado
                });
                break;
            }
            
            // Ángel Caído - Juicio Final: Reduce vida del objetivo a 1 HP
            case "reduce_to_1": {
                if (!objetivo || objetivo.estado === "derrotado") {
                    return { error: true, mensaje: "Objetivo inválido" };
                }
                if (this.tieneEstado(objetivo, "invulnerable")) {
                    resultado.efectos.push({
                        tipo: "bloqueado",
                        objetivo: objetivo.nombre,
                        indice: indiceObjetivo,
                        mensaje: `❌ ${objetivo.nombre} es INVULNERABLE - Juicio Final falló`
                    });
                    break;
                }
                let vidaAntes = objetivo.vidaActual;
                let danio = objetivo.vidaActual - 1;
                objetivo.vidaActual = 1;
                
                let msgDetallado = `👼 [ULTIMATE] ${atacante.nombre} usa 'Juicio Final' contra ${objetivo.nombre}\n`;
                msgDetallado += `   ⚠️ REDUCE A 1 HP\n`;
                msgDetallado += `   • Vida Antes: ${vidaAntes}\n`;
                msgDetallado += `   ═══ DAÑO FINAL: ${danio} ═══\n`;
                msgDetallado += `   ❤️ Vida: ${vidaAntes} → 1`;
                
                resultado.efectos.push({
                    tipo: "juicio_final",
                    objetivo: objetivo.nombre,
                    indice: indiceObjetivo,
                    danio: danio,
                    vidaAntes: vidaAntes,
                    vidaRestante: 1,
                    derrotado: false,
                    mensaje: msgDetallado
                });
                break;
            }
            
            // ==================== ✨ LUZ ULTIMATES ====================
            // Polilla - Sueño Eterno: Duerme 1 turno, +50% daño si despierta
            case "sleep_bonus": {
                if (!objetivo || objetivo.estado === "derrotado") {
                    return { error: true, mensaje: "Objetivo inválido" };
                }
                objetivo.estados = objetivo.estados || [];
                objetivo.estados.push({ tipo: "dormido", duracion: 2, bonusDanioAlDespertar: 0.50 });
                
                let msgDetallado = `🦋 [ULTIMATE] ${atacante.nombre} usa 'Sueño Eterno' contra ${objetivo.nombre}\n`;
                msgDetallado += `   ═══ DORMIDO (2 turnos) ═══\n`;
                msgDetallado += `   💤 ${objetivo.nombre} no puede actuar\n`;
                msgDetallado += `   ⚠️ +50% daño al despertar por ataque`;
                
                resultado.efectos.push({
                    tipo: "dormir",
                    objetivo: objetivo.nombre,
                    indice: indiceObjetivo,
                    dormido: true,
                    bonusDanio: 50,
                    mensaje: msgDetallado
                });
                break;
            }
            
            // Slime - Rebote: 100% daño + escudo igual al daño infligido
            case "dmg_100_shield_equal": {
                if (!objetivo || objetivo.estado === "derrotado") {
                    return { error: true, mensaje: "Objetivo inválido" };
                }
                let danioBase = atacante.ataque;
                let multiplicador = 1.0 * multiplicadorPasiva;
                let danio = Math.floor(danioBase * multiplicador);
                let vidaAntes = objetivo.vidaActual;
                let escudoAntes = atacante.escudo || 0;
                let resDanio = this.aplicarDanio(objetivo, danio);
                let escudo = resDanio.danioReal;
                atacante.escudo = escudoAntes + escudo;
                
                let msgDetallado = `🟢 [ULTIMATE] ${atacante.nombre} usa 'Rebote' contra ${objetivo.nombre}\n`;
                msgDetallado += `   • ATK Base: ${danioBase}\n`;
                msgDetallado += `   • Multiplicador (100%): ×${multiplicador.toFixed(2)}\n`;
                if (resDanio.danioReducidoDefensa > 0) {
                    msgDetallado += `   • Defensa (${resDanio.defensaRival}): -${resDanio.danioReducidoDefensa}\n`;
                }
                msgDetallado += `   ═══ DAÑO FINAL: ${resDanio.danioReal} ═══\n`;
                msgDetallado += `   ❤️ ${objetivo.nombre}: ${vidaAntes} → ${resDanio.vidaDespues}${resDanio.derrotado ? ' 💀' : ''}\n`;
                msgDetallado += `   ─── ESCUDO GANADO ───\n`;
                msgDetallado += `   🛡️ ${atacante.nombre}: ${escudoAntes} → ${atacante.escudo} (+${escudo})`;
                
                resultado.efectos.push({
                    tipo: "rebote",
                    objetivo: objetivo.nombre,
                    indice: indiceObjetivo,
                    danio: resDanio.danioReal,
                    escudoGanado: escudo,
                    escudoAntes: escudoAntes,
                    vidaAntes: vidaAntes,
                    vidaRestante: objetivo.vidaActual,
                    derrotado: objetivo.estado === "derrotado",
                    revivido: resDanio.revivido,
                    mensaje: msgDetallado
                });
                break;
            }
            
            // Unicornio - Cuerno de Luz: Cura 100% vida aliado + quita estados negativos
            case "full_heal_cleanse": {
                let aliadoObjetivo = equipoAliado[indiceObjetivo] || atacante;
                if (aliadoObjetivo.estado !== "derrotado") {
                    let vidaAntes = aliadoObjetivo.vidaActual;
                    let curacion = aliadoObjetivo.vida - aliadoObjetivo.vidaActual;
                    aliadoObjetivo.vidaActual = aliadoObjetivo.vida;
                    // Quitar estados negativos
                    let estadosNegativos = ["quemado", "quemado_grave", "envenenado", "envenenado_grave", "congelado", "aturdido", "paralizado", "cegado", "dormido", "anti_curacion"];
                    let estadosEliminados = (aliadoObjetivo.estados || []).filter(e => estadosNegativos.includes(e.tipo)).map(e => e.tipo);
                    aliadoObjetivo.estados = (aliadoObjetivo.estados || []).filter(e => !estadosNegativos.includes(e.tipo));
                    
                    let msgDetallado = `🦄 [ULTIMATE] ${atacante.nombre} usa 'Cuerno de Luz' en ${aliadoObjetivo.nombre}\n`;
                    msgDetallado += `   ═══ CURACIÓN TOTAL ═══\n`;
                    msgDetallado += `   💚 Vida: ${vidaAntes} → ${aliadoObjetivo.vidaActual} (+${curacion})\n`;
                    if (estadosEliminados.length > 0) {
                        msgDetallado += `   ✨ Estados Eliminados: ${estadosEliminados.join(', ')}`;
                    } else {
                        msgDetallado += `   ✨ Sin estados negativos para limpiar`;
                    }
                    
                    resultado.efectos.push({
                        tipo: "curacion_total_limpieza",
                        objetivo: aliadoObjetivo.nombre,
                        indice: indiceObjetivo,
                        curacion: curacion,
                        vidaAntes: vidaAntes,
                        vidaActual: aliadoObjetivo.vidaActual,
                        estadosEliminados: estadosEliminados,
                        limpiado: true,
                        mensaje: msgDetallado
                    });
                }
                break;
            }
            
            // León Solar - Explosión Solar: AoE 80% + 50% prob. cegar
            case "aoe_80_blind50": {
                let danioBase = Math.floor(atacante.ataque * 0.8 * multiplicadorPasiva);
                let objetivosAfectados = [];
                
                equipoRival.forEach((enemigo, idx) => {
                    if (enemigo.estado !== "derrotado") {
                        let vidaAntes = enemigo.vidaActual;
                        let resDanio = this.aplicarDanio(enemigo, danioBase);
                        let rollCegar = Math.random();
                        let cegado = rollCegar < 0.50;
                        if (cegado && enemigo.estado !== "derrotado") {
                            enemigo.estados = enemigo.estados || [];
                            enemigo.estados.push({ tipo: "cegado", duracion: 2 });
                        }
                        objetivosAfectados.push({
                            nombre: enemigo.nombre,
                            vidaAntes: vidaAntes,
                            vidaDespues: resDanio.vidaDespues,
                            danio: resDanio.danioReal,
                            derrotado: resDanio.derrotado,
                            cegado: cegado,
                            rollCegar: (rollCegar * 100).toFixed(1)
                        });
                        resultado.efectos.push({
                            tipo: "aoe_ceguera",
                            objetivo: enemigo.nombre,
                            indice: idx,
                            danio: resDanio.danioReal,
                            cegado: cegado,
                            vidaAntes: vidaAntes,
                            vidaRestante: enemigo.vidaActual,
                            derrotado: enemigo.estado === "derrotado",
                            revivido: resDanio.revivido
                        });
                    }
                });
                
                let msgAoe = `☀️ [ULTIMATE] ${atacante.nombre} usa 'Explosión Solar' (AoE 80% + 50% cegar)\n`;
                msgAoe += `   • ATK Base: ${atacante.ataque} × 0.8 = ${danioBase}\n`;
                msgAoe += `   ─── Impactos ───\n`;
                objetivosAfectados.forEach(obj => {
                    msgAoe += `   • ${obj.nombre}: ${obj.vidaAntes} → ${obj.vidaDespues} (-${obj.danio})`;
                    msgAoe += obj.derrotado ? ' 💀' : '';
                    msgAoe += ` | Roll: ${obj.rollCegar}%${obj.cegado ? ' 👁️CEGADO' : ''}\n`;
                });
                resultado.mensajeAoe = msgAoe;
                break;
            }
            
            // Valquiria - Luz Sagrada: 150% daño + cura al equipo el daño infligido
            case "dmg_150_heal_equal": {
                let msgDetallado = `⚔️ [ULTIMATE] ${atacante.nombre} usa 'Luz Sagrada'\n`;
                
                if (objetivo && objetivo.estado !== "derrotado") {
                    let danioBase = atacante.ataque;
                    let multiplicador = 1.5 * multiplicadorPasiva;
                    let danio = Math.floor(danioBase * multiplicador);
                    let vidaAntes = objetivo.vidaActual;
                    let resDanio = this.aplicarDanio(objetivo, danio);
                    
                    msgDetallado += `   ─── DAÑO ───\n`;
                    msgDetallado += `   • ATK Base: ${danioBase} × 1.5 = ${danio}\n`;
                    if (resDanio.danioReducidoDefensa > 0) {
                        msgDetallado += `   • Defensa: -${resDanio.danioReducidoDefensa}\n`;
                    }
                    msgDetallado += `   ═══ DAÑO FINAL: ${resDanio.danioReal} ═══\n`;
                    msgDetallado += `   ❤️ ${objetivo.nombre}: ${vidaAntes} → ${resDanio.vidaDespues}${resDanio.derrotado ? ' 💀' : ''}\n`;
                    
                    resultado.efectos.push({
                        tipo: "danio",
                        objetivo: objetivo.nombre,
                        indice: indiceObjetivo,
                        danio: resDanio.danioReal,
                        vidaAntes: vidaAntes,
                        vidaRestante: objetivo.vidaActual,
                        derrotado: objetivo.estado === "derrotado",
                        revivido: resDanio.revivido
                    });
                    
                    // Curar equipo con el daño dividido
                    let curacionBase = Math.floor(resDanio.danioReal / 3);
                    msgDetallado += `   ─── CURACIÓN (Daño/${3} = ${curacionBase}) ───\n`;
                    
                    equipoAliado.forEach((aliado, idx) => {
                        if (aliado.estado !== "derrotado") {
                            let vidaAntesAliado = aliado.vidaActual;
                            let curacionReal = Math.min(curacionBase, aliado.vida - aliado.vidaActual);
                            aliado.vidaActual += curacionReal;
                            msgDetallado += `   💚 ${aliado.nombre}: ${vidaAntesAliado} → ${aliado.vidaActual} (+${curacionReal})\n`;
                            if (curacionReal > 0) {
                                resultado.efectos.push({
                                    tipo: "curacion",
                                    objetivo: aliado.nombre,
                                    indice: idx,
                                    curacion: curacionReal,
                                    vidaAntes: vidaAntesAliado,
                                    vidaActual: aliado.vidaActual
                                });
                            }
                        }
                    });
                }
                
                resultado.efectos.push({ tipo: "mensajeCompleto", mensaje: msgDetallado });
                break;
            }
            
            // ==================== ⚡ GOD TIER ====================
            // ZENITH - EL FIN: Victoria instantánea
            case "instant_win": {
                partida.estado = "finalizada";
                partida.ganador = nick;
                partida.turnoInicio = null;
                resultado.ganador = nick;
                resultado.turno = null;
                
                let msgDetallado = `⚡ [ULTIMATE] ${atacante.nombre} usa 'EL FIN'\n`;
                msgDetallado += `   ═════════════════════════════\n`;
                msgDetallado += `   🌟 VICTORIA INSTANTÁNEA 🌟\n`;
                msgDetallado += `   El universo ha decretado el final\n`;
                msgDetallado += `   ═════════════════════════════`;
                
                resultado.efectos.push({
                    tipo: "victoria_instantanea",
                    mensaje: msgDetallado
                });
                let ganadorObj = this.usuarios[atacanteJugador.email];
                if (ganadorObj) {
                    ganadorObj.monedas += 100;
                    resultado.recompensa = 100;
                }
                break;
            }
            
            default:
                resultado.efectos.push({
                    tipo: "desconocido",
                    mensaje: `Efecto '${codigoEfecto}' no implementado`
                });
        }
        
        // === v2.0: Añadir efectos de pasiva al resultado ===
        if (pasivaAtacante && pasivaAtacante.aplicada) {
            resultado.pasivaAtacanteEfectos = pasivaAtacante.efectos || [];
        }
        
        // Verificar victoria
        if (this.equipoDerrotado(equipoRival) && !resultado.ganador) {
            partida.estado = "finalizada";
            partida.ganador = nick;
            partida.turnoInicio = null;
            resultado.ganador = nick;
            resultado.turno = null;
            
            let ganadorObj = this.usuarios[atacanteJugador.email];
            if (ganadorObj) {
                ganadorObj.monedas += 50;
                resultado.recompensa = 50;
            }
        } else if (!resultado.ganador) {
            // === PROCESAR ESTADOS AL CAMBIAR TURNO (Ultimate) v3.0 ===
            let efectosEstadosDefensor = this.procesarEstadosTurno(defensorJugador.equipo);
            if (efectosEstadosDefensor.length > 0) {
                resultado.efectosEstados = efectosEstadosDefensor;
            }
            
            // === v2.0: Procesar pasivas de inicio de turno del defensor ===
            let efectosInicioTurno = this.procesarPasivasInicioTurno(defensorJugador.equipo, atacanteJugador.equipo);
            if (efectosInicioTurno.length > 0) {
                resultado.efectosInicioTurno = efectosInicioTurno;
            }
            
            // === v3.0: Verificar victoria después de efectos de aura/pasivas ===
            // Verificar si el ATACANTE murió por Aura Muerte del defensor
            if (this.equipoDerrotado(atacanteJugador.equipo)) {
                partida.estado = "finalizada";
                partida.ganador = defensorJugador.nick;
                partida.turnoInicio = null;
                resultado.ganador = defensorJugador.nick;
                resultado.turno = null;
                
                let ganadorObj = this.usuarios[defensorJugador.email];
                if (ganadorObj) {
                    ganadorObj.monedas += 50;
                    resultado.recompensa = 50;
                }
            }
            // Verificar si el DEFENSOR murió por efectos de estado
            else if (this.equipoDerrotado(defensorJugador.equipo)) {
                partida.estado = "finalizada";
                partida.ganador = nick;
                partida.turnoInicio = null;
                resultado.ganador = nick;
                resultado.turno = null;
                
                let ganadorObj = this.usuarios[atacanteJugador.email];
                if (ganadorObj) {
                    ganadorObj.monedas += 50;
                    resultado.recompensa = 50;
                }
            } else {
                partida.turno = defensorJugador.nick;
                partida.turnoInicio = Date.now();
            }
        }
        
        resultado.estadoMesa = this.obtenerEstadoMesa(codigo);
        return resultado;
    }
    
    // ==================== SISTEMA DE DAÑO CENTRALIZADO v3.0 ====================
    // Aplica daño considerando: invulnerabilidad, escudo, defensa, y muerte con revivir
    // Ahora incluye información detallada para el sistema de logging
    this.aplicarDanio = function(objetivo, danio, contexto = {}) {
        let vidaAntes = objetivo.vidaActual;
        let escudoAntes = objetivo.escudo || 0;
        
        // 1. Verificar invulnerabilidad
        if (this.tieneEstado(objetivo, "invulnerable")) {
            return { 
                danioReal: 0, 
                danioOriginal: danio, 
                danioReducidoDefensa: 0, 
                bloqueado: true, 
                escudoAbsorbido: 0, 
                vidaAntes: vidaAntes,
                vidaDespues: vidaAntes,
                mensaje: `🛡️ ${objetivo.nombre} es INVULNERABLE! (0 daño)`,
                logDetallado: `🛡️ [INVULNERABLE] ${objetivo.nombre} bloquea ${danio} de daño!`
            };
        }
        
        // 2. Calcular daño real considerando defensa
        let defensaEfectiva = objetivo.defensa || 0;
        let danioReducidoDefensa = Math.floor(defensaEfectiva * 0.5);
        let danioPostDefensa = Math.max(0, Math.floor(danio - danioReducidoDefensa));
        
        // 3. Absorber con escudo primero
        let escudoAbsorbido = 0;
        let danioReal = danioPostDefensa;
        if (objetivo.escudo && objetivo.escudo > 0) {
            if (objetivo.escudo >= danioReal) {
                escudoAbsorbido = danioReal;
                objetivo.escudo -= danioReal;
                danioReal = 0;
            } else {
                escudoAbsorbido = objetivo.escudo;
                danioReal -= objetivo.escudo;
                objetivo.escudo = 0;
            }
        }
        
        // 4. Aplicar daño a vida
        objetivo.vidaActual -= danioReal;
        let vidaDespues = objetivo.vidaActual;
        
        let resultado = {
            danioReal: danioReal,
            danioOriginal: danio,
            danioPreDefensa: danio,
            danioPostDefensa: danioPostDefensa,
            danioReducidoDefensa: danioReducidoDefensa,
            defensaRival: defensaEfectiva,
            escudoAbsorbido: escudoAbsorbido,
            escudoAntes: escudoAntes,
            escudoDespues: objetivo.escudo || 0,
            vidaAntes: vidaAntes,
            vidaDespues: Math.max(0, vidaDespues),
            derrotado: false,
            revivido: false,
            mensaje: null
        };
        
        // 5. Verificar muerte y pasiva de revivir
        if (objetivo.vidaActual <= 0) {
            objetivo.vidaActual = 0;
            resultado.vidaDespues = 0;
            
            // Intentar revivir con pasiva
            let pasivaRevivir = this.checkPasiva(objetivo, "morir", contexto);
            if (pasivaRevivir && pasivaRevivir.revivido) {
                resultado.revivido = true;
                resultado.vidaDespues = objetivo.vidaActual;
                resultado.mensaje = pasivaRevivir.efectos[0]?.mensaje || `${objetivo.nombre} ha revivido!`;
            } else {
                objetivo.estado = "derrotado";
                resultado.derrotado = true;
            }
        }
        
        // 6. +1 maná al recibir daño (si sigue vivo)
        let manaAntes = objetivo.mana;
        if (objetivo.estado !== "derrotado" && objetivo.mana < objetivo.manaMax && danioReal > 0) {
            objetivo.mana = Math.min(objetivo.mana + 1, objetivo.manaMax);
            resultado.manaGanado = true;
            resultado.manaAntes = manaAntes;
            resultado.manaDespues = objetivo.mana;
        }
        
        // Generar log detallado
        let logLines = [];
        logLines.push(`   • Daño Bruto: ${danio}`);
        if (danioReducidoDefensa > 0) {
            logLines.push(`   • Defensa (${defensaEfectiva} → -${danioReducidoDefensa}): ${danioPostDefensa}`);
        }
        if (escudoAbsorbido > 0) {
            logLines.push(`   • Escudo Absorbió: -${escudoAbsorbido}`);
        }
        logLines.push(`   ═══ DAÑO FINAL: ${danioReal} ═══`);
        logLines.push(`   ❤️ Vida: ${vidaAntes} → ${resultado.vidaDespues}`);
        if (resultado.derrotado) logLines.push(`   💀 ¡DERROTADO!`);
        if (resultado.revivido) logLines.push(`   ✨ ¡REVIVIDO!`);
        resultado.logDetallado = logLines.join('\n');
        
        return resultado;
    }
    
    // Aplica daño directo (ignora defensa pero respeta invulnerabilidad y revivir)
    this.aplicarDanioDirecto = function(objetivo, danio, contexto = {}) {
        let vidaAntes = objetivo.vidaActual;
        
        // 1. Verificar invulnerabilidad
        if (this.tieneEstado(objetivo, "invulnerable")) {
            return { 
                danioReal: 0, 
                bloqueado: true, 
                vidaAntes: vidaAntes,
                vidaDespues: vidaAntes,
                mensaje: `🛡️ ${objetivo.nombre} es INVULNERABLE!`,
                logDetallado: `🛡️ [INVULNERABLE] ${objetivo.nombre} bloquea ${danio} de daño directo!`
            };
        }
        
        // 2. Aplicar daño directo (ignora defensa y escudo)
        objetivo.vidaActual -= danio;
        let vidaDespues = objetivo.vidaActual;
        
        let resultado = {
            danioReal: danio,
            vidaAntes: vidaAntes,
            vidaDespues: Math.max(0, vidaDespues),
            ignoraDefensa: true,
            derrotado: false,
            revivido: false,
            mensaje: null
        };
        
        // 3. Verificar muerte y pasiva de revivir
        if (objetivo.vidaActual <= 0) {
            objetivo.vidaActual = 0;
            resultado.vidaDespues = 0;
            
            let pasivaRevivir = this.checkPasiva(objetivo, "morir", contexto);
            if (pasivaRevivir && pasivaRevivir.revivido) {
                resultado.revivido = true;
                resultado.vidaDespues = objetivo.vidaActual;
                resultado.mensaje = pasivaRevivir.efectos[0]?.mensaje || `${objetivo.nombre} ha revivido!`;
            } else {
                objetivo.estado = "derrotado";
                resultado.derrotado = true;
            }
        }
        
        // 4. +1 maná al recibir daño
        let manaAntes = objetivo.mana;
        if (objetivo.estado !== "derrotado" && objetivo.mana < objetivo.manaMax) {
            objetivo.mana = Math.min(objetivo.mana + 1, objetivo.manaMax);
            resultado.manaGanado = true;
            resultado.manaAntes = manaAntes;
            resultado.manaDespues = objetivo.mana;
        }
        
        // Generar log detallado
        let logLines = [];
        logLines.push(`   ⚡ Daño Directo (ignora defensa): ${danio}`);
        logLines.push(`   ❤️ Vida: ${vidaAntes} → ${resultado.vidaDespues}`);
        if (resultado.derrotado) logLines.push(`   💀 ¡DERROTADO!`);
        if (resultado.revivido) logLines.push(`   ✨ ¡REVIVIDO!`);
        resultado.logDetallado = logLines.join('\n');
        
        return resultado;
    }

    // ==================== SISTEMA DE PASIVAS DE INICIO DE TURNO v2.0 ====================
    // Procesa pasivas al inicio del turno de un equipo
    this.procesarPasivasInicioTurno = function(equipo, equipoRival) {
        let efectosAplicados = [];
        
        equipo.forEach((personaje, idx) => {
            if (personaje.estado === "derrotado") return;
            
            let pasiva = this.checkPasiva(personaje, "inicio_turno", { equipoAliado: equipo });
            if (pasiva && pasiva.aplicada) {
                pasiva.efectos.forEach(efecto => {
                    efecto.indice = idx;
                    efectosAplicados.push(efecto);
                });
                
                // === LOG MENSAJE DE PASIVA (ej: Valquiria Valhalla) ===
                if (pasiva.logMensaje) {
                    efectosAplicados.push({
                        tipo: "log_pasiva",
                        mensaje: pasiva.logMensaje,
                        personaje: personaje.nombre
                    });
                }
                
                // === AURAS: Procesar efectos que afectan al equipo rival ===
                if (pasiva.auraMuerte && equipoRival) {
                    // Daño de aura = 5% de la vida MÁXIMA de cada enemigo
                    equipoRival.forEach((enemigo, idxEnemigo) => {
                        let danioPorAura = Math.floor((enemigo.vida || enemigo.vidaMax || 100) * 0.05);
                        if (enemigo.estado !== "derrotado") {
                            enemigo.vidaActual = Math.max(0, enemigo.vidaActual - danioPorAura);
                            efectosAplicados.push({
                                tipo: "aura_muerte_danio",
                                origen: personaje.nombre,
                                objetivo: enemigo.nombre,
                                indice: idxEnemigo,
                                danio: danioPorAura,
                                mensaje: `💀 El aura de ${personaje.nombre} daña a ${enemigo.nombre} (${danioPorAura})`
                            });
                            
                            if (enemigo.vidaActual <= 0) {
                                enemigo.estado = "derrotado";
                                efectosAplicados.push({
                                    tipo: "muerte_por_aura",
                                    personaje: enemigo.nombre,
                                    indice: idxEnemigo,
                                    mensaje: `💀 ${enemigo.nombre} ha caído por Aura de Muerte!`
                                });
                            }
                        }
                    });
                }
            }
        });
        
        return efectosAplicados;
    }

    // ==================== SISTEMA DE ESTADOS v3.0 ====================
    // Procesa los efectos de estado DESPUÉS de cada acción (ataque, ultimate, etc.)
    // Cada "turno" = una acción realizada en el juego
    this.procesarEstadosTurno = function(equipo) {
        let efectosAplicados = [];
        
        equipo.forEach((personaje, idx) => {
            if (personaje.estado === "derrotado" || !personaje.estados) return;
            
            let estadosActivos = [];
            
            personaje.estados.forEach(estado => {
                let efectoAplicado = null;
                
                // Procesar efectos de daño por estado después de cada acción
                switch (estado.tipo) {
                    case "quemado":
                        // Daño = 5% de vida máxima por turno
                        let vidaAntesQuemado = personaje.vidaActual;
                        let danioQuemado = Math.max(1, Math.floor(personaje.vida * 0.05));
                        personaje.vidaActual = Math.max(0, personaje.vidaActual - danioQuemado);
                        let msgQuemado = `🔥 [DOT] ${personaje.nombre}: Quemadura\n`;
                        msgQuemado += `   • Daño (5% de ${personaje.vida}): ${danioQuemado}\n`;
                        msgQuemado += `   ❤️ Vida: ${vidaAntesQuemado} → ${personaje.vidaActual}`;
                        msgQuemado += ` (${estado.duracion - 1} turnos restantes)`;
                        efectoAplicado = {
                            tipo: "quemado",
                            personaje: personaje.nombre,
                            indice: idx,
                            danio: danioQuemado,
                            vidaAntes: vidaAntesQuemado,
                            vidaDespues: personaje.vidaActual,
                            turnosRestantes: estado.duracion - 1,
                            mensaje: msgQuemado
                        };
                        break;
                    
                    case "quemado_grave":
                        // Quemadura grave = 10% de vida máxima por turno (Ifrit)
                        let vidaAntesQuemGrave = personaje.vidaActual;
                        let danioQuemadoGrave = estado.danioPorTurno || Math.floor(personaje.vida * 0.10);
                        personaje.vidaActual = Math.max(0, personaje.vidaActual - danioQuemadoGrave);
                        let msgQuemGrave = `🔥🔥 [DOT] ${personaje.nombre}: Quemadura Grave\n`;
                        msgQuemGrave += `   • Daño (${estado.danioPorTurno ? 'fijo' : '10%'}): ${danioQuemadoGrave}\n`;
                        msgQuemGrave += `   ❤️ Vida: ${vidaAntesQuemGrave} → ${personaje.vidaActual}`;
                        msgQuemGrave += ` (${estado.duracion - 1} turnos restantes)`;
                        if (personaje.vidaActual <= 0) msgQuemGrave += ` 💀`;
                        efectoAplicado = {
                            tipo: "quemado_grave",
                            personaje: personaje.nombre,
                            indice: idx,
                            danio: danioQuemadoGrave,
                            vidaAntes: vidaAntesQuemGrave,
                            vidaDespues: personaje.vidaActual,
                            turnosRestantes: estado.duracion - 1,
                            mensaje: msgQuemGrave
                        };
                        break;
                        
                    case "envenenado":
                        // Daño de veneno normal (5% vida o danioPorTurno)
                        let vidaAntesVeneno = personaje.vidaActual;
                        let danioVeneno = estado.danioPorTurno || Math.floor(personaje.vida * 0.05);
                        personaje.vidaActual = Math.max(0, personaje.vidaActual - danioVeneno);
                        let msgVeneno = `☠️ [DOT] ${personaje.nombre}: Veneno\n`;
                        msgVeneno += `   • Daño (${estado.danioPorTurno ? 'fijo' : '5%'}): ${danioVeneno}\n`;
                        msgVeneno += `   ❤️ Vida: ${vidaAntesVeneno} → ${personaje.vidaActual}`;
                        msgVeneno += ` (${estado.duracion - 1} turnos restantes)`;
                        efectoAplicado = {
                            tipo: "envenenado",
                            personaje: personaje.nombre,
                            indice: idx,
                            danio: danioVeneno,
                            vidaAntes: vidaAntesVeneno,
                            vidaDespues: personaje.vidaActual,
                            turnosRestantes: estado.duracion - 1,
                            mensaje: msgVeneno
                        };
                        break;
                    
                    case "envenenado_grave":
                        // Veneno grave = 10% de vida máxima por turno (Araña)
                        let vidaAntesVenGrave = personaje.vidaActual;
                        let danioVenenoGrave = estado.danioPorTurno || Math.floor(personaje.vida * 0.10);
                        personaje.vidaActual = Math.max(0, personaje.vidaActual - danioVenenoGrave);
                        let msgVenGrave = `☠️☠️ [DOT] ${personaje.nombre}: Veneno Letal\n`;
                        msgVenGrave += `   • Daño (${estado.danioPorTurno ? `${estado.danioPorTurno}/turno` : '10%'}): ${danioVenenoGrave}\n`;
                        msgVenGrave += `   ❤️ Vida: ${vidaAntesVenGrave} → ${personaje.vidaActual}`;
                        msgVenGrave += ` (${estado.duracion - 1} turnos restantes)`;
                        if (personaje.vidaActual <= 0) msgVenGrave += ` 💀`;
                        efectoAplicado = {
                            tipo: "envenenado_grave",
                            personaje: personaje.nombre,
                            indice: idx,
                            danio: danioVenenoGrave,
                            vidaAntes: vidaAntesVenGrave,
                            vidaDespues: personaje.vidaActual,
                            turnosRestantes: estado.duracion - 1,
                            mensaje: msgVenGrave
                        };
                        break;
                        
                    case "congelado":
                        // Congelación solo muestra estado, no hace daño
                        if (estado.duracion === 1) {
                            efectoAplicado = {
                                tipo: "congelado_expira",
                                personaje: personaje.nombre,
                                indice: idx,
                                pierdeTurno: false,
                                turnosRestantes: 0,
                                mensaje: `❄️ [ESTADO] ${personaje.nombre} se ha descongelado`
                            };
                        }
                        // No mostrar mensaje cada turno para congelado, solo cuando expira
                        break;
                        
                    case "aturdido":
                        // Aturdido solo muestra cuando expira
                        if (estado.duracion === 1) {
                            efectoAplicado = {
                                tipo: "aturdido_expira",
                                personaje: personaje.nombre,
                                indice: idx,
                                pierdeTurno: false,
                                turnosRestantes: 0,
                                mensaje: `💫 [ESTADO] ${personaje.nombre} se ha recuperado del aturdimiento`
                            };
                        }
                        break;
                        
                    case "paralizado":
                        // Parálisis solo muestra cuando expira
                        if (estado.duracion === 1) {
                            efectoAplicado = {
                                tipo: "paralizado_expira",
                                personaje: personaje.nombre,
                                indice: idx,
                                pierdeTurno: false,
                                turnosRestantes: 0,
                                mensaje: `⚡ ${personaje.nombre} se ha recuperado de la parálisis!`
                            };
                        }
                        break;
                            
                    case "dormido":
                        // Dormido solo muestra cuando expira
                        if (estado.duracion === 1) {
                            efectoAplicado = {
                                tipo: "dormido_expira",
                                personaje: personaje.nombre,
                                indice: idx,
                                pierdeTurno: false,
                                turnosRestantes: 0,
                                mensaje: `💤 ${personaje.nombre} se ha despertado!`
                            };
                        }
                        break;
                        
                    case "cegado":
                        // Ceguera solo muestra cuando expira
                        if (estado.duracion === 1) {
                            efectoAplicado = {
                                tipo: "cegado_expira",
                                personaje: personaje.nombre,
                                indice: idx,
                                turnosRestantes: 0,
                                mensaje: `👁️ ${personaje.nombre} ha recuperado la visión!`
                            };
                        }
                        break;
                        
                    case "maldito":
                        // Maldición solo muestra cuando expira
                        if (estado.duracion === 1) {
                            efectoAplicado = {
                                tipo: "maldito_expira",
                                personaje: personaje.nombre,
                                indice: idx,
                                turnosRestantes: 0,
                                mensaje: `🌑 La maldición sobre ${personaje.nombre} ha terminado!`
                            };
                        }
                        break;
                }
                
                // Reducir duración
                estado.duracion--;
                
                // Mantener estado si aún tiene duración
                if (estado.duracion > 0) {
                    estadosActivos.push(estado);
                }
                
                if (efectoAplicado) {
                    efectosAplicados.push(efectoAplicado);
                }
            });
            
            // Actualizar lista de estados
            personaje.estados = estadosActivos;
            
            // Verificar si murió por daño de estado
            if (personaje.vidaActual <= 0) {
                personaje.vidaActual = 0;
                personaje.estado = "derrotado";
                efectosAplicados.push({
                    tipo: "muerte_por_estado",
                    personaje: personaje.nombre,
                    indice: idx,
                    mensaje: `💀 ${personaje.nombre} ha caído por efectos de estado!`
                });
            }
        });
        
        return efectosAplicados;
    }

    // Verificar si un personaje tiene un estado específico
    this.tieneEstado = function(personaje, tipoEstado) {
        if (!personaje || !personaje.estados) return false;
        return personaje.estados.some(e => e.tipo === tipoEstado);
    }

    // === SISTEMA DE INMUNIDADES A ESTADOS ===
    // Verifica si un personaje es inmune a un tipo de estado
    // ==================== SISTEMA DE INMUNIDADES v3.0 ====================
    this.esInmuneAEstado = function(personaje, tipoEstado) {
        if (!personaje || !personaje.pasiva) return false;
        
        let pasiva = personaje.pasiva.toLowerCase();
        
        // ZENITH - Omnipotencia: Inmune a TODO
        if (pasiva.includes("omnipotencia") || pasiva.includes("inmune a todo")) {
            return true;
        }
        
        // Ifrit - Espíritu Ígneo: Inmune a quemadura
        if (tipoEstado === "quemado" && (pasiva.includes("espíritu ígneo") || pasiva.includes("inmune a quemadura"))) {
            return true;
        }
        
        // Gólem - Inamovible: Inmune a stun Y congelación
        if (pasiva.includes("inamovible") || pasiva.includes("inmune a stun y congelación")) {
            if (tipoEstado === "aturdido" || tipoEstado === "stun" || tipoEstado === "congelado") {
                return true;
            }
        }
        
        // Unicornio - Pureza: Inmune a veneno, ceguera y stun
        if (pasiva.includes("pureza") || pasiva.includes("inmune a veneno, ceguera y stun")) {
            if (tipoEstado === "envenenado" || tipoEstado === "cegado" || tipoEstado === "aturdido" || tipoEstado === "stun") {
                return true;
            }
        }
        
        return false;
    }
    
    // Aplicar estado a un personaje (con verificación de inmunidad)
    this.aplicarEstado = function(personaje, estado) {
        if (!personaje || personaje.estado === "derrotado") return false;
        
        // Verificar inmunidad
        if (this.esInmuneAEstado(personaje, estado.tipo)) {
            return false;
        }
        
        // Inicializar array de estados si no existe
        personaje.estados = personaje.estados || [];
        
        // Aplicar estado
        personaje.estados.push(estado);
        return true;
    }
    
    // Verificar si un personaje puede actuar (no está aturdido/congelado/dormido)
    this.puedeActuar = function(personaje) {
        if (!personaje || personaje.estado === "derrotado") return false;
        if (!personaje.estados) return true;
        
        const estadosQueImpiden = ["congelado", "aturdido", "paralizado", "dormido"];
        return !personaje.estados.some(e => estadosQueImpiden.includes(e.tipo));
    }

    // Verificar si un equipo tiene la pasiva "Viento Cola" (primer turno garantizado)
    this.tieneVientoCola = function(equipo) {
        return equipo.some(p => 
            p.pasiva && 
            p.pasiva.toLowerCase().includes("viento cola") ||
            (p.pasiva && p.pasiva.toLowerCase().includes("ataca primero"))
        );
    }

    // ==================== SISTEMA DE PASIVAS v3.0 ====================
    // Todas las 35 pasivas implementadas según especificaciones
    this.checkPasiva = function(personaje, evento, contexto) {
        if (!personaje || !personaje.pasiva) return null;
        
        let pasiva = personaje.pasiva.toLowerCase();
        let resultado = { aplicada: false, efectos: [] };
        
        // Determinar si es verificación pre-daño o post-daño
        let esPostDanio = contexto && contexto.danio !== undefined;
        
        // === PASIVAS AL RECIBIR DAÑO (PRE) ===
        if (evento === "recibir_danio" && !esPostDanio) {
            // === EVASIÓN (usa estadística 'evasion' directamente) ===
            // La evasión viene de: estadística base + pasivas de equipo (Neblina)
            let probEvasion = personaje.evasion || 0; // Porcentaje directo (0-100)
            
            if (probEvasion > 0) {
                let atacanteIgnoraEvasion = false;
                if (contexto.atacante && contexto.atacante.pasiva) {
                    let pasivaAtacante = contexto.atacante.pasiva.toLowerCase();
                    // Águila - Vista Aguda: 100% precisión (ignora evasión)
                    if (pasivaAtacante.includes("vista aguda") || pasivaAtacante.includes("100% precisión") || pasivaAtacante.includes("ignora evasión")) {
                        atacanteIgnoraEvasion = true;
                        console.log(`[EVASION] Atacante ${contexto.atacante.nombre} ignora evasión!`);
                    }
                }
                
                if (!atacanteIgnoraEvasion) {
                    // Cap de evasión al 50% (excepto Zenith)
                    let probFinal = personaje.nombre === "ZENITH" ? probEvasion : Math.min(probEvasion, 50);
                    
                    let roll = Math.random() * 100;
                    console.log(`[EVASION] ${personaje.nombre}: evasion=${probFinal}%, roll=${roll.toFixed(0)}%, evade=${roll < probFinal}`);
                    
                    if (roll < probFinal) {
                        resultado.aplicada = true;
                        resultado.evadido = true;
                        resultado.efectos.push({
                            tipo: "evasion",
                            mensaje: `💨 ${personaje.nombre} evade el ataque!`
                        });
                    }
                }
            }
            
            // Leviatán - Piel Abisal: -30% daño recibido permanente
            if (pasiva.includes("piel abisal") || pasiva.includes("-30% daño recibido")) {
                resultado.aplicada = true;
                resultado.reduccionDanio = 0.30;
                resultado.efectos.push({
                    tipo: "reduccion_danio",
                    porcentaje: 30,
                    mensaje: `🐉 ${personaje.nombre} reduce el daño en 30%!`
                });
            }
            
            // Mantaraya - Vuelo: Inmune a daño de tipo Tierra
            if (pasiva.includes("vuelo") || pasiva.includes("inmune a") && pasiva.includes("tierra")) {
                if (contexto.atacante && contexto.atacante.tipo === "Tierra") {
                    resultado.aplicada = true;
                    resultado.evadido = true; // Tratarlo como evasión total
                    resultado.inmuneTipo = true;
                    resultado.efectos.push({
                        tipo: "inmunidad_tierra",
                        mensaje: `🦋 ${personaje.nombre} es inmune a ataques de Tierra!`
                    });
                }
            }
        }
        
        // === PASIVAS AL RECIBIR DAÑO (POST) ===
        if (evento === "recibir_danio" && esPostDanio) {
            // Salamandra - Piel Ardiente: 20% quemar atacante (5% vida/turno x3)
            if (pasiva.includes("piel ardiente") || pasiva.includes("20%") && pasiva.includes("quemar atacante")) {
                if (Math.random() < 0.20 && contexto.atacante) {
                    if (!this.esInmuneAEstado(contexto.atacante, "quemado")) {
                        contexto.atacante.estados = contexto.atacante.estados || [];
                        let danioPorTurno = Math.floor(contexto.atacante.vida * 0.05);
                        contexto.atacante.estados.push({ tipo: "quemado", duracion: 3, danioPorTurno: danioPorTurno });
                        resultado.aplicada = true;
                        resultado.efectos.push({
                            tipo: "quemar_atacante",
                            mensaje: `🔥 ${personaje.nombre} quema a ${contexto.atacante.nombre}!`
                        });
                    }
                }
            }
            
            // Gigante Escarcha - Cero Absoluto: 25% congelar al atacante
            if (pasiva.includes("cero absoluto") || (pasiva.includes("25%") && pasiva.includes("congelar"))) {
                let roll = Math.random();
                if (roll < 0.25 && contexto.atacante) {
                    if (!this.esInmuneAEstado(contexto.atacante, "congelado")) {
                        contexto.atacante.estados = contexto.atacante.estados || [];
                        contexto.atacante.estados.push({ tipo: "congelado", duracion: 2 });
                        resultado.aplicada = true;
                        resultado.efectos.push({
                            tipo: "congelar_atacante",
                            mensaje: `❄️ ${personaje.nombre} congela a ${contexto.atacante.nombre}!`
                        });
                    }
                }
            }
            
            // Minotauro - Reflejo: 20% contraataque (100% daño)
            if (pasiva.includes("reflejo") || pasiva.includes("20%") && pasiva.includes("contraataque")) {
                if (Math.random() < 0.20 && contexto.atacante && contexto.atacante.estado !== "derrotado") {
                    let danioContra = personaje.ataque;
                    contexto.atacante.vidaActual = Math.max(0, contexto.atacante.vidaActual - danioContra);
                    if (contexto.atacante.vidaActual <= 0) {
                        contexto.atacante.estado = "derrotado";
                    }
                    resultado.aplicada = true;
                    resultado.contraataque = true;
                    resultado.efectos.push({
                        tipo: "contraataque",
                        danio: danioContra,
                        mensaje: `🐂 ${personaje.nombre} contraataca! ${danioContra} daño!`
                    });
                }
            }
            
            // Caballero Oscuro - Venganza: Devuelve 30% del daño recibido
            if (pasiva.includes("venganza") || pasiva.includes("devuelve 30%")) {
                if (contexto.atacante && contexto.danio > 0) {
                    let danioReflejado = Math.floor(contexto.danio * 0.30);
                    contexto.atacante.vidaActual = Math.max(0, contexto.atacante.vidaActual - danioReflejado);
                    if (contexto.atacante.vidaActual <= 0) {
                        contexto.atacante.estado = "derrotado";
                    }
                    resultado.aplicada = true;
                    resultado.efectos.push({
                        tipo: "reflejo_danio",
                        danioReflejado: danioReflejado,
                        mensaje: `⚔️ ${personaje.nombre} devuelve ${danioReflejado} daño!`
                    });
                }
            }
            
            // Cofre Mímico - Última Risa: Explota al morir (100% ataque al asesino)
            if (pasiva.includes("última risa") || pasiva.includes("explota al morir")) {
                if (personaje.vidaActual <= 0 && contexto.atacante) {
                    let explosion = personaje.ataque;
                    contexto.atacante.vidaActual = Math.max(0, contexto.atacante.vidaActual - explosion);
                    if (contexto.atacante.vidaActual <= 0) {
                        contexto.atacante.estado = "derrotado";
                    }
                    resultado.aplicada = true;
                    resultado.efectos.push({
                        tipo: "explosion",
                        danio: explosion,
                        mensaje: `💥 ${personaje.nombre} explota causando ${explosion} daño!`
                    });
                }
            }
            
            // Polilla - Polvo: 15% cegar atacante (50% precisión)
            if (pasiva.includes("polvo") || pasiva.includes("15%") && pasiva.includes("cegar")) {
                if (Math.random() < 0.15 && contexto.atacante) {
                    contexto.atacante.estados = contexto.atacante.estados || [];
                    if (!contexto.atacante.estados.some(e => e.tipo === "cegado")) {
                        contexto.atacante.estados.push({ tipo: "cegado", duracion: 2, reduccionPrecision: 0.50 });
                        resultado.aplicada = true;
                        resultado.efectos.push({
                            tipo: "cegar_atacante",
                            mensaje: `🦋 ${personaje.nombre} ciega a ${contexto.atacante.nombre}!`
                        });
                    }
                }
            }
        }
        
        // === PASIVAS AL ATACAR ===
        if (evento === "atacar") {
            // Escorpión - Tenazas: Ignora 10% defensa rival permanente
            if (pasiva.includes("tenazas") || pasiva.includes("ignora 10% defensa")) {
                resultado.aplicada = true;
                resultado.ignorarDefensa = 0.10;
                resultado.efectos.push({
                    tipo: "perforar_defensa",
                    porcentaje: 10,
                    mensaje: `🦂 ${personaje.nombre} ignora 10% de defensa!`
                });
            }
            
            // Centauro - Carga: Primer ataque +50% daño
            if (pasiva.includes("carga:") || pasiva.includes("primer ataque +50%")) {
                if (!personaje.cargaUsada) {
                    resultado.aplicada = true;
                    resultado.bonusDanio = 0.50;
                    personaje.cargaUsada = true;
                    resultado.efectos.push({
                        tipo: "carga",
                        mensaje: `🐴 ${personaje.nombre} carga con +50% de daño!`
                    });
                }
            }
            
            // Dragón Rojo - Furia: +1% daño por cada 1% vida que te falta
            if (pasiva.includes("furia:") || pasiva.includes("+1% daño por cada 1% vida")) {
                let porcentajeVidaPerdida = (1 - (personaje.vidaActual / personaje.vida)) * 100;
                let bonusFuria = porcentajeVidaPerdida / 100; // Cada 1% vida = 1% daño
                if (bonusFuria > 0) {
                    resultado.aplicada = true;
                    resultado.bonusDanio = (resultado.bonusDanio || 0) + bonusFuria;
                    resultado.efectos.push({
                        tipo: "furia",
                        bonus: Math.floor(bonusFuria * 100),
                        mensaje: `🔥 ${personaje.nombre} enfurece! +${Math.floor(bonusFuria * 100)}% daño!`
                    });
                }
            }
            
            // Medusa - Tóxico: 30% prob. envenenar al atacar (5% vida/turno, 3 turnos)
            if (pasiva.includes("tóxico") || (pasiva.includes("30%") && pasiva.includes("envenenar"))) {
                let roll = Math.random();
                if (roll < 0.30) {
                    resultado.aplicada = true;
                    resultado.aplicarVeneno = true;
                    resultado.efectos.push({
                        tipo: "envenenar",
                        probabilidad: 30,
                        mensaje: `☠️ ${personaje.nombre} envenena al objetivo!`
                    });
                }
            }
            
            // Araña Sombría - Telaraña: 25% prob. de paralizar al atacar
            if (pasiva.includes("telaraña") || (pasiva.includes("25%") && pasiva.includes("paralizar"))) {
                let roll = Math.random();
                if (roll < 0.25) {
                    resultado.aplicada = true;
                    resultado.aplicarParalisis = true;
                    resultado.efectos.push({
                        tipo: "paralizar",
                        probabilidad: 25,
                        mensaje: `🕸️ ${personaje.nombre} atrapa al objetivo en su telaraña!`
                    });
                }
            }
            
            // Tiburón - Rastro de Sangre: Crítico automático si rival <30% HP
            if (pasiva.includes("rastro de sangre") || pasiva.includes("crítico") && pasiva.includes("<30%")) {
                if (contexto.objetivo && (contexto.objetivo.vidaActual / contexto.objetivo.vida) < 0.30) {
                    resultado.aplicada = true;
                    resultado.criticoGarantizado = true;
                    resultado.efectos.push({
                        tipo: "sangre",
                        mensaje: `🦈 ${personaje.nombre} huele la sangre! ¡Crítico!`
                    });
                }
            }
            
            // Águila - Vista Aguda: 100% precisión (ignora evasión)
            if (pasiva.includes("vista aguda") || pasiva.includes("100% precisión")) {
                resultado.aplicada = true;
                resultado.ignoraEvasion = true;
                resultado.efectos.push({
                    tipo: "ignora_evasion",
                    mensaje: `🦅 ${personaje.nombre} no puede ser evadido!`
                });
            }
            
            // Cerbero - Tres Cabezas: Ataque básico = 3 golpes de 40%
            if (pasiva.includes("tres cabezas") || pasiva.includes("3") && pasiva.includes("golpes")) {
                resultado.aplicada = true;
                resultado.ataquesMultiples = 3;
                resultado.multiplicadorAtaque = 0.40;
                resultado.efectos.push({
                    tipo: "ataque_triple",
                    mensaje: `🐕 ${personaje.nombre} ataca 3 veces!`
                });
            }
            
            // Lobo - Manada: +15% ataque por aliado vivo (máx +30%)
            if (pasiva.includes("manada") || pasiva.includes("+15%") && pasiva.includes("aliado")) {
                if (contexto.equipoAliado) {
                    let aliadosVivos = contexto.equipoAliado.filter(a => 
                        a.estado !== "derrotado" && a.uid !== personaje.uid
                    ).length;
                    let bonusManada = Math.min(aliadosVivos * 0.15, 0.30); // Max 30%
                    if (bonusManada > 0) {
                        resultado.aplicada = true;
                        resultado.bonusDanio = (resultado.bonusDanio || 0) + bonusManada;
                        resultado.efectos.push({
                            tipo: "manada",
                            bonus: Math.floor(bonusManada * 100),
                            mensaje: `🐺 ${personaje.nombre} manada! +${Math.floor(bonusManada * 100)}% daño!`
                        });
                    }
                }
            }
        }
        
        // === PASIVAS AL MORIR ===
        if (evento === "morir") {
            // Slime - Mitosis: Revive 1 vez con 50% HP
            if (pasiva.includes("mitosis") || pasiva.includes("revive 1 vez con 50%")) {
                if (!personaje.mitosisUsada) {
                    personaje.vidaActual = Math.floor(personaje.vida * 0.50);
                    personaje.estado = "activo";
                    personaje.mitosisUsada = true;
                    resultado.aplicada = true;
                    resultado.revivido = true;
                    resultado.efectos.push({
                        tipo: "mitosis",
                        vidaRestaurada: personaje.vidaActual,
                        mensaje: `🟢 ${personaje.nombre} usa Mitosis y revive con ${personaje.vidaActual} HP!`
                    });
                }
            }
        }
        
        // === PASIVAS AL DEFENDER ===
        if (evento === "defender") {
            // Ent - Raíces: Al defender, cura 10% vida máxima
            if (pasiva.includes("raíces") || pasiva.includes("defender") && pasiva.includes("cura 10%")) {
                let curacion = Math.floor(personaje.vida * 0.10);
                personaje.vidaActual = Math.min(personaje.vidaActual + curacion, personaje.vida);
                resultado.aplicada = true;
                resultado.efectos.push({
                    tipo: "raices",
                    curacion: curacion,
                    mensaje: `🌳 ${personaje.nombre} regenera ${curacion} HP con Raíces!`
                });
            }
        }
        
        // === PASIVAS INICIO DE TURNO ===
        if (evento === "inicio_turno") {
            // Poseidón - Mareas Vivas: Recupera 5% vida al inicio de tu turno
            if (pasiva.includes("mareas vivas") || pasiva.includes("recupera 5% vida")) {
                let regeneracion = Math.floor(personaje.vida * 0.05);
                personaje.vidaActual = Math.min(personaje.vidaActual + regeneracion, personaje.vida);
                resultado.aplicada = true;
                resultado.efectos.push({
                    tipo: "mareas",
                    curacion: regeneracion,
                    mensaje: `🌊 ${personaje.nombre} recupera ${regeneracion} HP!`
                });
            }
            
            // Ángel Caído - Aura de Muerte: Enemigos pierden 5% vida máx cada turno
            if (pasiva.includes("aura de muerte") || pasiva.includes("enemigos pierden 5%")) {
                resultado.aplicada = true;
                resultado.auraMuerte = true;
                resultado.auraDanio = 0.05; // 5% vida máxima
                resultado.efectos.push({
                    tipo: "aura_muerte",
                    mensaje: `👼 El aura de ${personaje.nombre} daña a los enemigos!`
                });
            }
            
            // Valquiria - Valhalla: 25% prob. revivir aliado muerto con 50% HP
            if (pasiva.includes("valhalla") || pasiva.includes("25%") && pasiva.includes("revivir aliado")) {
                if (contexto.equipoAliado && Math.random() < 0.25) {
                    let aliadoCaido = contexto.equipoAliado.find(a => 
                        a.estado === "derrotado" && a.uid !== personaje.uid && !a.revividoPorValhalla
                    );
                    if (aliadoCaido) {
                        let vidaRevivir = Math.floor(aliadoCaido.vida * 0.5); // 50% de vida máxima
                        aliadoCaido.vidaActual = vidaRevivir;
                        aliadoCaido.estado = "activo";
                        aliadoCaido.revividoPorValhalla = true;
                        resultado.aplicada = true;
                        resultado.logMensaje = `⚔️ [VALHALLA] ${personaje.nombre} invoca el poder de Valhalla!\n   ✨ ${aliadoCaido.nombre} RESUCITA con ${vidaRevivir}/${aliadoCaido.vida} HP (50%)`;
                        resultado.efectos.push({
                            tipo: "valhalla_revive",
                            aliado: aliadoCaido.nombre,
                            vidaRevivida: vidaRevivir,
                            vidaMaxima: aliadoCaido.vida,
                            mensaje: `⚔️ ${personaje.nombre} invoca Valhalla! ${aliadoCaido.nombre} renace con ${vidaRevivir} HP (50%)!`
                        });
                    }
                }
            }
            
            // ZENITH - Omnipotencia: Inmune a todo (daño, estados, muerte)
            if (pasiva.includes("omnipotencia") || pasiva.includes("inmune a todo")) {
                personaje.estados = [];
                resultado.aplicada = true;
                resultado.efectos.push({
                    tipo: "omnipotencia",
                    mensaje: `🌟 ${personaje.nombre} es OMNIPOTENTE!`
                });
            }
        }
        
        return resultado;
    }

    // Crear partida con equipo de 3 personajes
    this.crearPartida = function(email, equipoUIDs, nickReal) {
        let usuario = this.usuarios[email];
        if (!usuario) {
            return { codigo: -1, mensaje: "Usuario no encontrado" };
        }
        
        // Validar equipo
        let validacion = this.validarEquipo(usuario, equipoUIDs);
        if (!validacion.valido) {
            return { codigo: -1, mensaje: validacion.mensaje };
        }
        
        // Construir equipo de luchadores
        let equipoLuchadores = validacion.equipo.map(inst => this.construirLuchador(inst));
        if (equipoLuchadores.includes(null)) {
            return { codigo: -1, mensaje: "Error al construir equipo" };
        }
        
        let codigo = this.obtenerCodigo();
        let partida = new Partida(codigo);
        
        // Agregar jugador con su equipo - usar nick real si se proporciona
        partida.jugadores.push({
            nick: nickReal || usuario.nick,
            email: usuario.email,
            equipo: equipoLuchadores
        });
        
        this.partidas[codigo] = partida;
        return { codigo: codigo, mensaje: "Partida creada" };
    }

    // Unirse a partida con equipo de 3 personajes
    this.unirAPartida = function(email, codigo, equipoUIDs, nickReal) {
        let usuario = this.usuarios[email];
        let partida = this.partidas[codigo];
        
        if (!usuario) {
            return { codigo: -1, mensaje: "Usuario no encontrado" };
        }
        if (!partida) {
            return { codigo: -1, mensaje: "Partida no encontrada" };
        }
        if (partida.jugadores.length >= partida.maxJug) {
            return { codigo: -1, mensaje: "La partida está llena" };
        }
        if (partida.jugadores.find(j => j.email === email)) {
            return { codigo: -1, mensaje: "Ya estás en esta partida" };
        }
        
        // Validar equipo
        let validacion = this.validarEquipo(usuario, equipoUIDs);
        if (!validacion.valido) {
            return { codigo: -1, mensaje: validacion.mensaje };
        }
        
        // Construir equipo de luchadores
        let equipoLuchadores = validacion.equipo.map(inst => this.construirLuchador(inst));
        if (equipoLuchadores.includes(null)) {
            return { codigo: -1, mensaje: "Error al construir equipo" };
        }
        
        // Agregar jugador con su equipo - usar nick real si se proporciona
        partida.jugadores.push({
            nick: nickReal || usuario.nick,
            email: usuario.email,
            equipo: equipoLuchadores
        });
        
        // === TURNO INICIAL v2.0: Pasiva "Viento Cola" + Velocidad ===
        let equipoJ1 = partida.jugadores[0].equipo;
        let equipoJ2 = partida.jugadores[1].equipo;
        
        // Verificar si algún equipo tiene la pasiva "Viento Cola" (primer turno garantizado)
        let j1TieneVientoCola = this.tieneVientoCola(equipoJ1);
        let j2TieneVientoCola = this.tieneVientoCola(equipoJ2);
        
        if (j1TieneVientoCola && !j2TieneVientoCola) {
            // J1 tiene Viento Cola, J2 no → J1 empieza
            partida.turno = partida.jugadores[0].nick;
            partida.razonTurnoInicial = "viento_cola";
        } else if (j2TieneVientoCola && !j1TieneVientoCola) {
            // J2 tiene Viento Cola, J1 no → J2 empieza
            partida.turno = partida.jugadores[1].nick;
            partida.razonTurnoInicial = "viento_cola";
        } else {
            // Ambos tienen o ninguno tiene → usar velocidad
            let velocidadJ1 = this.calcularVelocidadEquipo(equipoJ1);
            let velocidadJ2 = this.calcularVelocidadEquipo(equipoJ2);
            
            partida.velocidadEquipos = { j1: velocidadJ1, j2: velocidadJ2 };
            
            // En caso de empate, el jugador 1 (host) empieza
            if (velocidadJ2 > velocidadJ1) {
                partida.turno = partida.jugadores[1].nick;
            } else {
                partida.turno = partida.jugadores[0].nick;
            }
            partida.razonTurnoInicial = "velocidad";
        }
        
        partida.turnoInicio = Date.now();
        partida.estado = "en_curso";
        
        // Seleccionar fondo aleatorio para la batalla
        let fondosDisponibles = data.FondosBatalla || [];
        if (fondosDisponibles.length > 0) {
            let fondoIndex = Math.floor(Math.random() * fondosDisponibles.length);
            partida.fondo = fondosDisponibles[fondoIndex];
            
            // Aplicar modificadores de fondo a ambos equipos
            this.aplicarModificadoresFondo(partida);
        }
        
        return {
            codigo: codigo,
            owner: partida.jugadores[0].nick,
            rival: partida.jugadores[1].nick,
            mensaje: "Unido a la partida"
        };
    }
    
    // Aplicar modificadores de estadísticas según el fondo de batalla
    this.aplicarModificadoresFondo = function(partida) {
        if (!partida.fondo) return;
        
        // Inicializar logs de setup al inicio
        partida.logsSetup = partida.logsSetup || [];
        
        const tipoFondo = partida.fondo.tipo;
        const mod = data.ModificadorFondo || { bonificacion: 1.15, penalizacion: 0.85 };
        const tablaTipos = data.TablaTipos || {};
        
        // Tipos que son countered por el tipo del fondo
        const tiposDebiles = tablaTipos[tipoFondo] || [];
        
        partida.jugadores.forEach(jugador => {
            jugador.equipo.forEach(personaje => {
                // Guardar stats originales si no existen
                if (!personaje.statsOriginales) {
                    personaje.statsOriginales = {
                        ataque: personaje.ataque,
                        defensa: personaje.defensa,
                        vida: personaje.vida,
                        vidaActual: personaje.vidaActual
                    };
                }
                
                let multiplicador = 1;

                // ZENITH: Bonificación en CUALQUIER escenario (+20%)
                if (personaje.nombre === "ZENITH") {
                    multiplicador = 1.20;
                    personaje.efectoFondo = 'bonificado-divino';
                }
                // Bonificación si el personaje es del mismo tipo que el fondo
                else if (personaje.tipo === tipoFondo) {
                    multiplicador = mod.bonificacion;
                    personaje.efectoFondo = 'bonificado';
                }
                // Penalización si el personaje es débil contra el tipo del fondo
                else if (tiposDebiles.includes(personaje.tipo)) {
                    multiplicador = mod.penalizacion;
                    personaje.efectoFondo = 'penalizado';
                } else {
                    personaje.efectoFondo = 'neutral';
                }
                
                // Aplicar multiplicador
                personaje.ataque = Math.round(personaje.statsOriginales.ataque * multiplicador);
                personaje.defensa = Math.round(personaje.statsOriginales.defensa * multiplicador);
                personaje.vida = Math.round(personaje.statsOriginales.vida * multiplicador);
                personaje.vidaActual = Math.round(personaje.statsOriginales.vidaActual * multiplicador);
                
                // === PASIVAS INDIVIDUALES DE INICIO DE BATALLA ===
                let logsPersonaje = this.aplicarPasivasInicioBatalla(personaje, jugador.equipo);
                if (logsPersonaje && logsPersonaje.length > 0) {
                    partida.logsSetup = partida.logsSetup.concat(logsPersonaje);
                }
            });
        });
        
        // === PASIVAS DE EQUIPO (después de inicializar todos los personajes) ===
        this.aplicarPasivasEquipoInicioBatalla(partida);
    }
    
    // Aplicar pasivas que afectan a todo el equipo o enemigos al inicio de batalla
    this.aplicarPasivasEquipoInicioBatalla = function(partida) {
        if (!partida || !partida.jugadores || partida.jugadores.length < 2) return;
        
        // Inicializar array de logs de setup
        partida.logsSetup = partida.logsSetup || [];
        
        partida.jugadores.forEach((jugador, jugadorIdx) => {
            let equipoAliado = jugador.equipo;
            let equipoEnemigo = partida.jugadores[(jugadorIdx + 1) % 2].equipo;
            
            equipoAliado.forEach(personaje => {
                if (!personaje || !personaje.pasiva || personaje.estado === "derrotado") return;
                let pasiva = personaje.pasiva.toLowerCase();
                
                // === LEÓN SOLAR - Rey Sol: +10% ATK/DEF a todo el equipo ===
                if (pasiva.includes("rey sol") || (pasiva.includes("+10%") && pasiva.includes("aliados"))) {
                    if (!personaje.reySolAplicado) {
                        let afectados = [];
                        equipoAliado.forEach(aliado => {
                            if (aliado !== personaje && aliado.estado !== "derrotado") {
                                let atkAntes = aliado.ataque;
                                let defAntes = aliado.defensa;
                                aliado.ataque = Math.round(aliado.ataque * 1.10);
                                aliado.defensa = Math.round(aliado.defensa * 1.10);
                                aliado.buffReySol = true;
                                afectados.push(`${aliado.nombre}: ATK ${atkAntes}→${aliado.ataque}, DEF ${defAntes}→${aliado.defensa}`);
                            }
                        });
                        personaje.reySolAplicado = true;
                        let logSetup = `📊 [SETUP] ${personaje.nombre}: Pasiva 'Rey Sol' (+10% ATK/DEF aliados)\n   • ${afectados.join('\n   • ')}`;
                        partida.logsSetup.push(logSetup);
                        console.log(`[PASIVA] Rey Sol de ${personaje.nombre}: +10% ATK/DEF a aliados`);
                    }
                }
                
                // === GUARDIÁN AÉREO - Neblina: +10% Evasión a todo el equipo ===
                if (pasiva.includes("neblina") || pasiva.includes("+10% evasión")) {
                    if (!personaje.neblinaAplicada) {
                        let afectados = [];
                        equipoAliado.forEach(aliado => {
                            let evasionAntes = aliado.evasion || 0;
                            aliado.evasion = evasionAntes + 10;
                            aliado.tieneNeblina = true;
                            afectados.push(`${aliado.nombre}: Evasión ${evasionAntes}% → ${aliado.evasion}%`);
                        });
                        personaje.neblinaAplicada = true;
                        let logSetup = `📊 [SETUP] ${personaje.nombre}: Pasiva 'Neblina' (+10% Evasión equipo)\n   • ${afectados.join('\n   • ')}`;
                        partida.logsSetup.push(logSetup);
                        console.log(`[PASIVA] Neblina de ${personaje.nombre}: +10% evasión a todo el equipo`);
                    }
                }
                
                // === SURTUR - Cataclismo: -20% Defensa a todos los enemigos ===
                if (pasiva.includes("cataclismo") || pasiva.includes("-20% defensa")) {
                    if (!personaje.cataclismoAplicado) {
                        let afectados = [];
                        equipoEnemigo.forEach(enemigo => {
                            if (enemigo.estado !== "derrotado") {
                                let defAntes = enemigo.defensa;
                                enemigo.defensa = Math.round(enemigo.defensa * 0.80);
                                enemigo.debuffCataclismo = true;
                                afectados.push(`${enemigo.nombre}: DEF ${defAntes} → ${enemigo.defensa}`);
                            }
                        });
                        personaje.cataclismoAplicado = true;
                        let logSetup = `📊 [SETUP] ${personaje.nombre}: Pasiva 'Cataclismo' (-20% DEF enemigos)\n   • ${afectados.join('\n   • ')}`;
                        partida.logsSetup.push(logSetup);
                        console.log(`[PASIVA] Cataclismo de ${personaje.nombre}: -20% defensa a enemigos`);
                    }
                }
            });
        });
    }
    
    // Aplicar pasivas que se activan al inicio de la batalla
    // ==================== PASIVAS INICIO DE BATALLA v3.0 ====================
    this.aplicarPasivasInicioBatalla = function(personaje, equipo) {
        if (!personaje || !personaje.pasiva) return [];
        
        let pasiva = personaje.pasiva.toLowerCase();
        let logsSetup = [];
        
        // Behemoth - Titán: +50% vida máxima permanente
        if (pasiva.includes("titán") || pasiva.includes("+50% vida")) {
            if (!personaje.titanAplicado) {
                let vidaAntes = personaje.vida;
                let bonusVida = Math.floor(personaje.vida * 0.50);
                personaje.vida += bonusVida;
                personaje.vidaActual += bonusVida;
                personaje.titanAplicado = true;
                logsSetup.push(`📊 [SETUP] ${personaje.nombre}: Pasiva 'Titán' (+50% Vida)\n   • Vida: ${vidaAntes} → ${personaje.vida} (+${bonusVida})`);
            }
        }
        
        // Gárgola - Piel de Piedra: Escudo inicial = 20% vida
        if (pasiva.includes("piel de piedra") || pasiva.includes("escudo inicial") && pasiva.includes("20%")) {
            if (!personaje.escudoInicial) {
                let escudo = Math.floor(personaje.vida * 0.20);
                personaje.escudo = escudo;
                personaje.escudoInicial = true;
                logsSetup.push(`📊 [SETUP] ${personaje.nombre}: Pasiva 'Piel de Piedra' (Escudo Inicial)\n   • Escudo: 0 → ${escudo} (20% de ${personaje.vida})`);
            }
        }
        
        // Guardián Aéreo - Neblina: +10% evasión a todo el equipo
        // (Este buff se aplica al equipo en el turno, no aquí directamente)
        if (pasiva.includes("neblina") || pasiva.includes("+10% evasión equipo")) {
            personaje.tieneNeblina = true;
        }
        
        // León Solar - Rey Sol: +10% ATK/DEF a todo el equipo
        if (pasiva.includes("rey sol") || pasiva.includes("+10% atk/def equipo")) {
            personaje.tieneReySol = true;
        }
        
        // === THUNDERBIRD - Batería: Equipo inicia con +1 Maná extra ===
        if (pasiva.includes("batería") || pasiva.includes("+1 maná")) {
            if (!personaje.bateriaAplicada && equipo) {
                let detalles = [];
                equipo.forEach(p => {
                    let manaAntes = p.mana || 0;
                    p.mana = Math.min(manaAntes + 1, p.manaMax || 4);
                    detalles.push(`${p.nombre}: ${manaAntes} → ${p.mana}`);
                });
                personaje.bateriaAplicada = true;
                logsSetup.push(`📊 [SETUP] ${personaje.nombre}: Pasiva 'Batería' (+1 Maná al equipo)\n   • ${detalles.join('\n   • ')}`);
            }
        }
        
        // Log de evasión base si existe
        if (personaje.evasion > 0 && !personaje.evasionLogueada) {
            logsSetup.push(`📊 [SETUP] ${personaje.nombre}: Evasión Base ${personaje.evasion}%`);
            personaje.evasionLogueada = true;
        }
        
        // Inicializar arrays de estados si no existen
        personaje.estados = personaje.estados || [];
        
        return logsSetup;
    }

    // Obtener estado completo de la mesa (6 personajes)
    this.obtenerEstadoMesa = function(codigo) {
        let partida = this.partidas[codigo];
        if (!partida) return null;
        
        return {
            codigo: partida.codigo,
            estado: partida.estado || "esperando",
            turno: partida.turno,
            turnoInicio: partida.turnoInicio || null,
            ganador: partida.ganador || null,
            fondo: partida.fondo || null,
            velocidadEquipos: partida.velocidadEquipos || null, // v2.0
            razonTurnoInicial: partida.razonTurnoInicial || null, // v2.0
            logsSetup: partida.logsSetup || [], // v3.0: Logs de pasivas al inicio
            jugadores: partida.jugadores.map(j => ({
                nick: j.nick,
                equipo: j.equipo.map(p => ({
                    uid: p.uid,
                    nombre: p.nombre,
                    tipo: p.tipo,
                    img: p.img,
                    rareza: p.rareza,
                    nivel: p.nivel,
                    rango: p.rango,
                    vida: p.vida,
                    vidaActual: p.vidaActual,
                    ataque: p.ataque,
                    defensa: p.defensa,
                    estado: p.estado,
                    estaDefendiendo: p.estaDefendiendo,
                    efectoFondo: p.efectoFondo || 'neutral',
                    // Nuevas propiedades v2.0
                    velocidad: p.velocidad || 50,
                    mana: p.mana || 0,
                    manaMax: p.manaMax || 4,
                    pasiva: p.pasiva || null,
                    ultimate: p.ultimate || null,
                    // Estados de efecto (quemado, envenenado, etc.)
                    estados: p.estados || [],
                    escudo: p.escudo || 0
                }))
            }))
        };
    }

    // Verificar si un equipo está completamente derrotado
    this.equipoDerrotado = function(equipo) {
        return equipo.every(p => p.estado === "derrotado");
    }

    // Acción de defender (un personaje específico)
    this.defender = function(codigo, nick, indiceLuchador) {
        let partida = this.partidas[codigo];
        if (!partida || partida.turno !== nick || partida.estado !== "en_curso") {
            return null;
        }
        
        let jugador = partida.jugadores.find(j => j.nick === nick);
        let rival = partida.jugadores.find(j => j.nick !== nick);
        if (!jugador || !rival) return null;
        
        let luchador = jugador.equipo[indiceLuchador];
        if (!luchador || luchador.estado === "derrotado") {
            return null;
        }
        
        // === v2.0: Verificar si puede actuar (estados de control) ===
        if (!this.puedeActuar(luchador)) {
            // NO cambiar turno - solo avisar
            let estadoImpide = luchador.estados.find(e => 
                ["congelado", "aturdido", "paralizado", "dormido"].includes(e.tipo)
            );
            
            return {
                error: true,
                noPuedeActuar: true,
                razon: estadoImpide ? estadoImpide.tipo : "estado",
                mensaje: `${luchador.nombre} no puede actuar (${estadoImpide ? estadoImpide.tipo : 'estado'})`
            };
        }
        
        luchador.estaDefendiendo = true;
        
        // === v2.0: Ejecutar pasiva de defender ===
        let pasivaDefender = this.checkPasiva(luchador, "defender", { equipoAliado: jugador.equipo });
        let efectosPasiva = pasivaDefender ? pasivaDefender.efectos : [];
        
        // Cambiar turno
        partida.turno = rival.nick;
        partida.turnoInicio = Date.now();
        
        // === v2.0: Procesar pasivas de inicio de turno del rival ===
        let efectosInicioTurno = this.procesarPasivasInicioTurno(rival.equipo, jugador.equipo);
        
        // === v2.0: Procesar estados del rival (veneno, quemado, etc.) ===
        let efectosEstados = this.procesarEstadosTurno(rival.equipo);
        
        // === v3.0: Verificar victoria después de efectos de aura/estados ===
        let ganador = null;
        let recompensa = 0;
        
        // El jugador actual puede morir por aura de muerte del rival
        if (this.equipoDerrotado(jugador.equipo)) {
            partida.estado = "finalizada";
            partida.ganador = rival.nick;
            partida.turnoInicio = null;
            ganador = rival.nick;
            
            let ganadorObj = this.usuarios[rival.email];
            if (ganadorObj) {
                ganadorObj.monedas += 50;
                recompensa = 50;
            }
        }
        // El rival puede morir por efectos de estado (veneno, etc.)
        else if (this.equipoDerrotado(rival.equipo)) {
            partida.estado = "finalizada";
            partida.ganador = nick;
            partida.turnoInicio = null;
            ganador = nick;
            
            let ganadorObj = this.usuarios[jugador.email];
            if (ganadorObj) {
                ganadorObj.monedas += 50;
                recompensa = 50;
            }
        }
        
        return {
            accion: "defender",
            jugador: nick,
            indiceLuchador: indiceLuchador,
            luchadorNombre: luchador.nombre,
            turno: ganador ? null : partida.turno,
            ganador: ganador,
            recompensa: recompensa,
            pasivaDefenderEfectos: efectosPasiva,
            efectosInicioTurno: efectosInicioTurno,
            efectosEstados: efectosEstados,
            estadoMesa: this.obtenerEstadoMesa(codigo)
        };
    }

    // ==================== SALTAR TURNO ====================
    // Permite al jugador saltar su turno voluntariamente
    this.saltarTurno = function(codigo, nick) {
        let partida = this.partidas[codigo];
        if (!partida || partida.turno !== nick || partida.estado !== "en_curso") {
            return { error: true, mensaje: "No es tu turno o la partida no está en curso" };
        }
        
        let jugador = partida.jugadores.find(j => j.nick === nick);
        let rival = partida.jugadores.find(j => j.nick !== nick);
        if (!jugador || !rival) return { error: true, mensaje: "Error al encontrar jugadores" };
        
        // Cambiar turno al rival
        partida.turno = rival.nick;
        partida.turnoInicio = Date.now();
        
        // Procesar pasivas de inicio de turno del rival
        let efectosInicioTurno = this.procesarPasivasInicioTurno(rival.equipo, jugador.equipo);
        
        // Procesar estados del rival
        let efectosEstados = this.procesarEstadosTurno(rival.equipo);

        // Añadir mensajes generados por pasivas/estados al log de la partida para que los clientes los vean
        partida.logsSetup = partida.logsSetup || [];
        efectosInicioTurno.forEach(e => {
            if (e && e.mensaje) partida.logsSetup.push(e.mensaje);
            // También incluir mensajes de tipo log_pasiva
            if (e && e.tipo === 'log_pasiva' && e.mensaje) partida.logsSetup.push(`✨ [PASIVA] ${e.personaje}: ${e.mensaje}`);
        });
        efectosEstados.forEach(e => {
            if (e && e.mensaje) partida.logsSetup.push(e.mensaje);
        });
        
        // === v3.0: Verificar victoria después de efectos de aura/estados ===
        let ganador = null;
        let recompensa = 0;
        
        // El jugador actual puede morir por aura de muerte del rival
        if (this.equipoDerrotado(jugador.equipo)) {
            partida.estado = "finalizada";
            partida.ganador = rival.nick;
            partida.turnoInicio = null;
            ganador = rival.nick;
            
            let ganadorObj = this.usuarios[rival.email];
            if (ganadorObj) {
                ganadorObj.monedas += 50;
                recompensa = 50;
            }
        }
        // El rival puede morir por efectos de estado (veneno, etc.)
        else if (this.equipoDerrotado(rival.equipo)) {
            partida.estado = "finalizada";
            partida.ganador = nick;
            partida.turnoInicio = null;
            ganador = nick;
            
            let ganadorObj = this.usuarios[jugador.email];
            if (ganadorObj) {
                ganadorObj.monedas += 50;
                recompensa = 50;
            }
        }
        
        // Construir mensaje resumido para clientes que esperan un texto
        let mensajesResumen = [];
        mensajesResumen.push(`${nick} ha saltado el turno.`);
        efectosInicioTurno.forEach(e => { if (e && e.mensaje) mensajesResumen.push(e.mensaje); });
        efectosEstados.forEach(e => { if (e && e.mensaje) mensajesResumen.push(e.mensaje); });

        return {
            accion: "saltar_turno",
            jugador: nick,
            turno: ganador ? null : partida.turno,
            ganador: ganador,
            recompensa: recompensa,
            efectosInicioTurno: efectosInicioTurno,
            efectosEstados: efectosEstados,
            mensajes: mensajesResumen,
            mensaje: mensajesResumen.join('\n'),
            estadoMesa: this.obtenerEstadoMesa(codigo)
        };
    }

    // Realizar acción de ataque (3v3)
    this.realizarAccion = function(codigo, nick, indiceAtacante, indiceObjetivo) {
        let partida = this.partidas[codigo];
        
        // Validaciones básicas
        if (!partida) {
            return { error: true, mensaje: "Partida no encontrada" };
        }
        if (partida.turno !== nick) {
            return { error: true, mensaje: "No es tu turno" };
        }
        if (partida.estado !== "en_curso") {
            return { error: true, mensaje: "La partida no está en curso" };
        }
        
        let atacanteJugador = partida.jugadores.find(j => j.nick === nick);
        let defensorJugador = partida.jugadores.find(j => j.nick !== nick);
        
        if (!atacanteJugador || !defensorJugador) {
            return { error: true, mensaje: "Error al encontrar jugadores" };
        }
        
        // Validar índices
        if (indiceAtacante < 0 || indiceAtacante > 2 || indiceObjetivo < 0 || indiceObjetivo > 2) {
            return { error: true, mensaje: "Índice de personaje inválido" };
        }
        
        let atacante = atacanteJugador.equipo[indiceAtacante];
        let defensor = defensorJugador.equipo[indiceObjetivo];
        
        // === v2.0: Verificar si puede actuar ===
        if (!this.puedeActuar(atacante)) {
            let estadoImpide = atacante.estados?.find(e => 
                ["congelado", "aturdido", "paralizado", "dormido"].includes(e.tipo)
            );
            
            // NO cambiar turno - permitir al jugador elegir otro personaje
            // Solo avisar que este personaje no puede actuar
            return {
                error: true,
                noPuedeActuar: true,
                razon: estadoImpide ? estadoImpide.tipo : "estado",
                mensaje: `${atacante.nombre} no puede actuar (${estadoImpide ? estadoImpide.tipo : 'estado'})`,
                atacante: { nick: nick, indice: indiceAtacante, nombre: atacante.nombre }
            };
        }
        
        // Validar que los personajes estén activos
        if (atacante.estado === "derrotado") {
            return { error: true, mensaje: "Tu personaje está derrotado" };
        }
        if (defensor.estado === "derrotado") {
            return { error: true, mensaje: "El objetivo ya está derrotado" };
        }
        
        // === SISTEMA DE PASIVAS v2.0: Check pasiva al atacar ===
        let pasivaAtacante = this.checkPasiva(atacante, "atacar", {
            objetivo: defensor,
            equipoAliado: atacanteJugador.equipo
        });
        
        // === v3.0: CHECK CEGUERA DEL ATACANTE ===
        // Si el atacante está cegado, tiene 35% de probabilidad de fallar el ataque
        if (atacante.estados && atacante.estados.some(e => e.tipo === "cegado")) {
            if (Math.random() < 0.35) {
                // +1 maná al atacar aunque falle
                if (atacante.mana < atacante.manaMax) {
                    atacante.mana = Math.min(atacante.mana + 1, atacante.manaMax);
                }
                
                partida.turno = defensorJugador.nick;
                partida.turnoInicio = Date.now();
                
                return {
                    accion: "atacar",
                    fallo: true,
                    razon: "cegado",
                    atacante: {
                        nick: nick,
                        indice: indiceAtacante,
                        nombre: atacante.nombre,
                        tipo: atacante.tipo
                    },
                    defensor: {
                        nick: defensorJugador.nick,
                        indice: indiceObjetivo,
                        nombre: defensor.nombre,
                        tipo: defensor.tipo
                    },
                    danio: 0,
                    vidaRestante: defensor.vidaActual,
                    turno: defensorJugador.nick,
                    ganador: null,
                    estadoMesa: this.obtenerEstadoMesa(codigo),
                    mensaje: `👁️ ${atacante.nombre} falla el ataque por estar cegado!`
                };
            }
        }
        
        // === SISTEMA DE PASIVAS v2.0: Check evasión del defensor ===
        let pasivaDefensor = this.checkPasiva(defensor, "recibir_danio", {
            atacante: atacante,
            equipoAliado: defensorJugador.equipo
        });
        
        // Si el defensor evade, terminar el ataque
        if (pasivaDefensor && pasivaDefensor.evadido) {
            // +1 maná al atacar aunque falle
            if (atacante.mana < atacante.manaMax) {
                atacante.mana = Math.min(atacante.mana + 1, atacante.manaMax);
            }
            
            let resultadoEvasion = {
                accion: "atacar",
                evadido: true,
                atacante: {
                    nick: nick,
                    indice: indiceAtacante,
                    nombre: atacante.nombre,
                    tipo: atacante.tipo
                },
                defensor: {
                    nick: defensorJugador.nick,
                    indice: indiceObjetivo,
                    nombre: defensor.nombre,
                    tipo: defensor.tipo
                },
                danio: 0,
                vidaRestante: defensor.vidaActual,
                pasivaEfectos: pasivaDefensor.efectos,
                turno: defensorJugador.nick,
                ganador: null
            };
            
            partida.turno = defensorJugador.nick;
            partida.turnoInicio = Date.now();
            resultadoEvasion.estadoMesa = this.obtenerEstadoMesa(codigo);
            return resultadoEvasion;
        }
        
        // === PASIVAS: Verificar inmunidad a tipo ===
        if (pasivaDefensor && pasivaDefensor.inmuneTipo) {
            // +1 maná al atacar aunque falle
            if (atacante.mana < atacante.manaMax) {
                atacante.mana = Math.min(atacante.mana + 1, atacante.manaMax);
            }
            
            let resultadoInmune = {
                accion: "atacar",
                inmune: true,
                atacante: {
                    nick: nick,
                    indice: indiceAtacante,
                    nombre: atacante.nombre,
                    tipo: atacante.tipo
                },
                defensor: {
                    nick: defensorJugador.nick,
                    indice: indiceObjetivo,
                    nombre: defensor.nombre,
                    tipo: defensor.tipo
                },
                danio: 0,
                vidaRestante: defensor.vidaActual,
                pasivaEfectos: pasivaDefensor.efectos,
                turno: defensorJugador.nick,
                ganador: null
            };
            
            partida.turno = defensorJugador.nick;
            partida.turnoInicio = Date.now();
            resultadoInmune.estadoMesa = this.obtenerEstadoMesa(codigo);
            return resultadoInmune;
        }
        
        // === v3.0: VERIFICAR INVULNERABILIDAD ===
        if (this.tieneEstado(defensor, "invulnerable")) {
            // +1 maná al atacar aunque sea bloqueado
            if (atacante.mana < atacante.manaMax) {
                atacante.mana = Math.min(atacante.mana + 1, atacante.manaMax);
            }
            
            partida.turno = defensorJugador.nick;
            partida.turnoInicio = Date.now();
            
            return {
                accion: "atacar",
                bloqueadoPorInvulnerable: true,
                atacante: {
                    nick: nick,
                    indice: indiceAtacante,
                    nombre: atacante.nombre,
                    tipo: atacante.tipo
                },
                defensor: {
                    nick: defensorJugador.nick,
                    indice: indiceObjetivo,
                    nombre: defensor.nombre,
                    tipo: defensor.tipo
                },
                danio: 0,
                vidaRestante: defensor.vidaActual,
                turno: defensorJugador.nick,
                ganador: null,
                mensaje: `🛡️ ${defensor.nombre} es invulnerable y bloquea el ataque!`,
                estadoMesa: this.obtenerEstadoMesa(codigo)
            };
        }
        
        // Calcular daño
        let esCritico = false; // Crítico por pasiva/ultimate aleatorio
        let esCounter = false;  // Counter por ventaja de tipo elemental
        let esBloqueado = false;
        let multiplicador = 1;
        
        // Ventaja de tipo = COUNTER (no es lo mismo que crítico)
        if (data.TablaTipos[atacante.tipo] && data.TablaTipos[atacante.tipo].includes(defensor.tipo)) {
            multiplicador = 1.5;
            esCounter = true; // Es counter, no crítico
        }
        
        // === PASIVAS: Bonus daño ===
        let multiplicadorPasiva = 0; // Trackear bonus de pasiva
        if (pasivaAtacante && pasivaAtacante.bonusDanio) {
            multiplicador += pasivaAtacante.bonusDanio;
            multiplicadorPasiva += pasivaAtacante.bonusDanio;
        }
        if (pasivaAtacante && pasivaAtacante.criticoGarantizado) {
            esCritico = true; // Este SÍ es crítico real
            multiplicador *= 1.5;
        }
        
        let danioBase = atacante.ataque; // Daño base sin multiplicadores
        let ataqueTotal = atacante.ataque * multiplicador;
        let defensaTotal = defensor.defensa;
        
        // === PASIVAS: Ignorar defensa ===
        if (pasivaAtacante && pasivaAtacante.ignorarDefensa) {
            defensaTotal = Math.floor(defensaTotal * (1 - pasivaAtacante.ignorarDefensa));
        }
        
        // === PASIVAS: Reducir defensa del enemigo (Cataclismo) ===
        if (pasivaAtacante && pasivaAtacante.reducirDefensaEnemigo) {
            defensaTotal = Math.floor(defensaTotal * (1 - pasivaAtacante.reducirDefensaEnemigo));
        }
        
        // Bonus de defensa si estaba defendiendo
        if (defensor.estaDefendiendo) {
            defensaTotal = Math.floor(defensaTotal * 1.5);
            esBloqueado = true;
            defensor.estaDefendiendo = false;
        }
        
        let danio = Math.max(0, Math.floor(ataqueTotal - defensaTotal)); // Mínimo 0 de daño
        
        // Calcular daño reducido por defensa para el log
        let danioReducidoDefensa = Math.max(0, Math.floor(ataqueTotal) - danio);
        
        // === PASIVAS: Ataques múltiples ===
        let totalDanio = danio;
        if (pasivaAtacante && pasivaAtacante.ataquesMultiples) {
            totalDanio = Math.floor(danio * pasivaAtacante.multiplicadorAtaque * pasivaAtacante.ataquesMultiples);
        }
        
        // === PASIVAS: Reducción de daño recibido (Abisal) ===
        let danioReducidoPasiva = 0;
        if (pasivaDefensor && pasivaDefensor.reduccionDanio) {
            let danioAntes = totalDanio;
            totalDanio = Math.floor(totalDanio * (1 - pasivaDefensor.reduccionDanio));
            danioReducidoPasiva = danioAntes - totalDanio;
        }
        
        // Primero absorber escudo
        let escudoAbsorbido = 0;
        if (defensor.escudo && defensor.escudo > 0) {
            if (defensor.escudo >= totalDanio) {
                escudoAbsorbido = totalDanio;
                defensor.escudo -= totalDanio;
                totalDanio = 0;
            } else {
                escudoAbsorbido = defensor.escudo;
                totalDanio -= defensor.escudo;
                defensor.escudo = 0;
            }
        }
        
        defensor.vidaActual -= totalDanio;
        
        // === SISTEMA DE MANÁ v2.0 ===
        // +1 maná al atacar (max 4)
        if (atacante.mana < atacante.manaMax) {
            atacante.mana = Math.min(atacante.mana + 1, atacante.manaMax);
        }
        // +1 maná al recibir daño (max 4)
        if (defensor.mana < defensor.manaMax && totalDanio > 0) {
            defensor.mana = Math.min(defensor.mana + 1, defensor.manaMax);
        }
        
        // === PASIVAS: Aplicar veneno si corresponde ===
        if (pasivaAtacante && pasivaAtacante.aplicarVeneno) {
            defensor.estados = defensor.estados || [];
            // 5% vida/turno según data.js
            defensor.estados.push({ tipo: "envenenado", duracion: 3, danioPorTurno: Math.floor(defensor.vida * 0.05) });
        }
        
        // === PASIVAS: Aplicar parálisis si corresponde (Araña Sombría) ===
        if (pasivaAtacante && pasivaAtacante.aplicarParalisis) {
            defensor.estados = defensor.estados || [];
            defensor.estados.push({ tipo: "paralizado", duracion: 1 });
        }
        
        // === PASIVAS POST-DAÑO v2.0: Verificar efectos reactivos del defensor ===
        // Esta verificación ocurre DESPUÉS del daño para pasivas como "Piel Ardiente"
        if (totalDanio > 0 && defensor.estado !== "derrotado") {
            let pasivaPostDanio = this.checkPasiva(defensor, "recibir_danio", {
                atacante: atacante,
                danio: totalDanio,
                equipoAliado: defensorJugador.equipo
            });
            
            if (pasivaPostDanio && pasivaPostDanio.aplicada) {
                // Combinar efectos con los previos
                if (!pasivaDefensor) pasivaDefensor = { aplicada: false, efectos: [] };
                pasivaDefensor.efectos = pasivaDefensor.efectos.concat(pasivaPostDanio.efectos);
                pasivaDefensor.aplicada = true;
            }
        }
        
        // Verificar si el defensor fue derrotado
        let personajeDerrotado = false;
        if (defensor.vidaActual <= 0) {
            defensor.vidaActual = 0;
            defensor.estado = "derrotado";
            personajeDerrotado = true;
            
            // === PASIVAS: Check revivir al morir ===
            let pasivaRevivir = this.checkPasiva(defensor, "morir", {});
            if (pasivaRevivir && pasivaRevivir.revivido) {
                personajeDerrotado = false;
            }
        }
        
        // Preparar resultado
        let vidaAntes = defensor.vidaActual + totalDanio + escudoAbsorbido; // Reconstruir vida antes
        
        // Generar mensaje de log detallado
        let tipoImpacto = "";
        if (esCounter && esCritico) {
            tipoImpacto = " 🎯💥 COUNTER + CRÍTICO!";
        } else if (esCounter) {
            tipoImpacto = " 🎯 COUNTER!"; // Ventaja de tipo elemental
        } else if (esCritico) {
            tipoImpacto = " 💥 CRÍTICO!"; // Por pasiva/aleatorio
        }
        
        let msgLog = `⚔️ [ATAQUE] ${atacante.nombre} → ${defensor.nombre}${tipoImpacto}\n`;
        msgLog += `   📊 CÁLCULO DE DAÑO:\n`;
        msgLog += `   • ATK Base: ${danioBase} (stat del personaje)\n`;
        
        // Mostrar multiplicadores aplicados
        if (multiplicador !== 1 || esCounter || esCritico) {
            let razones = [];
            if (esCounter) razones.push(`COUNTER ×1.5 (${atacante.tipo} > ${defensor.tipo})`);
            if (multiplicadorPasiva > 0) razones.push(`Pasiva +${(multiplicadorPasiva * 100).toFixed(0)}%`);
            if (esCritico && !esCounter) razones.push(`Crítico ×1.5`);
            msgLog += `   • Multiplicadores: ×${multiplicador.toFixed(2)} [${razones.join(' + ')}]\n`;
            msgLog += `   • ATK Total: ${danioBase} × ${multiplicador.toFixed(2)} = ${Math.floor(ataqueTotal)}\n`;
        } else {
            msgLog += `   • ATK Total: ${Math.floor(ataqueTotal)} (sin bonificadores)\n`;
        }
        
        // Mostrar reducción de daño
        msgLog += `   📉 REDUCCIÓN:\n`;
        if (defensaTotal > 0) {
            msgLog += `   • Defensa enemiga (${defensaTotal}): bloqueó ${danioReducidoDefensa} de daño\n`;
        }
        if (esBloqueado) {
            msgLog += `   • 🛡️ DEFENSA ACTIVA: DEF ×1.5\n`;
        }
        if (danioReducidoPasiva > 0) {
            msgLog += `   • Pasiva defensiva: -${danioReducidoPasiva} daño reducido\n`;
        }
        if (escudoAbsorbido > 0) {
            msgLog += `   • 🔵 Escudo absorbió: ${escudoAbsorbido} daño\n`;
        }
        if (defensaTotal === 0 && danioReducidoPasiva === 0 && escudoAbsorbido === 0) {
            msgLog += `   • (Sin reducción)\n`;
        }
        
        // Resultado final
        msgLog += `   ═══════════════════════════\n`;
        msgLog += `   💥 DAÑO INFLIGIDO: ${totalDanio}\n`;
        msgLog += `   ❤️ Vida: ${Math.floor(vidaAntes)} → ${defensor.vidaActual}/${defensor.vida}`;
        if (personajeDerrotado) msgLog += ` 💀 DERROTADO!`;
        
        let resultado = {
            accion: "atacar",
            atacante: {
                nick: nick,
                indice: indiceAtacante,
                nombre: atacante.nombre,
                tipo: atacante.tipo
            },
            defensor: {
                nick: defensorJugador.nick,
                indice: indiceObjetivo,
                nombre: defensor.nombre,
                tipo: defensor.tipo
            },
            danio: totalDanio,
            danioBase: danioBase,                           // Ataque base del personaje
            ataqueTotal: Math.floor(ataqueTotal),           // Ataque con multiplicadores
            multiplicador: multiplicador,                   // Multiplicador total aplicado
            danioReducidoDefensa: danioReducidoDefensa,
            danioReducidoPasiva: danioReducidoPasiva,
            escudoAbsorbido: escudoAbsorbido,
            vidaAntes: Math.floor(vidaAntes),
            vidaRestante: defensor.vidaActual,
            esCritico: esCritico,                           // Crítico por pasiva/aleatorio
            esCounter: esCounter,                           // Counter por ventaja de tipo
            esBloqueado: esBloqueado,
            personajeDerrotado: personajeDerrotado,
            ganador: null,
            recompensa: 0,
            turno: defensorJugador.nick,
            // v2.0: Efectos de pasivas aplicados
            pasivaAtacanteEfectos: pasivaAtacante ? pasivaAtacante.efectos : [],
            pasivaDefensorEfectos: pasivaDefensor ? pasivaDefensor.efectos : [],
            // v3.0: Log detallado
            mensajeLog: msgLog
        };
        
        // Verificar condición de victoria
        if (this.equipoDerrotado(defensorJugador.equipo)) {
            partida.estado = "finalizada";
            partida.ganador = nick;
            partida.turnoInicio = null;
            resultado.ganador = nick;
            resultado.turno = null;
            
            // Recompensa al ganador - buscar por email, no por nick
            let ganadorObj = this.usuarios[atacanteJugador.email];
            if (ganadorObj) {
                ganadorObj.monedas += 50; // Recompensa por victoria 3v3
                resultado.recompensa = 50;
                if (this.cad.actualizarMonedas) {
                    this.cad.actualizarMonedas(ganadorObj, function(res) {
                        console.log("Monedas actualizadas tras victoria 3v3");
                    });
                }
            }
        } else {
            // === PROCESAR ESTADOS AL CAMBIAR TURNO v3.0 ===
            // Procesar efectos de estado del equipo que va a recibir el turno (después de cada acción)
            let efectosEstadosDefensor = this.procesarEstadosTurno(defensorJugador.equipo);
            if (efectosEstadosDefensor.length > 0) {
                resultado.efectosEstados = efectosEstadosDefensor;
            }
            
            // === v3.0: Procesar pasivas de inicio de turno del rival ===
            let efectosInicioTurno = this.procesarPasivasInicioTurno(defensorJugador.equipo, atacanteJugador.equipo);
            if (efectosInicioTurno.length > 0) {
                resultado.efectosInicioTurno = efectosInicioTurno;
            }
            
            // === v3.0: Verificar victoria después de efectos de aura/pasivas ===
            // Verificar si el ATACANTE murió por Aura Muerte del defensor
            if (this.equipoDerrotado(atacanteJugador.equipo)) {
                partida.estado = "finalizada";
                partida.ganador = defensorJugador.nick;
                partida.turnoInicio = null;
                resultado.ganador = defensorJugador.nick;
                resultado.turno = null;
                
                let ganadorObj = this.usuarios[defensorJugador.email];
                if (ganadorObj) {
                    ganadorObj.monedas += 50;
                    resultado.recompensa = 50;
                }
            }
            // Verificar si el DEFENSOR murió por efectos de estado
            else if (this.equipoDerrotado(defensorJugador.equipo)) {
                partida.estado = "finalizada";
                partida.ganador = nick;
                partida.turnoInicio = null;
                resultado.ganador = nick;
                resultado.turno = null;
                
                let ganadorObj = this.usuarios[atacanteJugador.email];
                if (ganadorObj) {
                    ganadorObj.monedas += 50;
                    resultado.recompensa = 50;
                }
            } else {
                // Cambiar turno
                partida.turno = defensorJugador.nick;
                partida.turnoInicio = Date.now();
            }
        }
        
        // Incluir estado completo de la mesa
        resultado.estadoMesa = this.obtenerEstadoMesa(codigo);
        
        return resultado;
    }

    // Mantener compatibilidad: atacar redirige a realizarAccion con índices por defecto
    this.atacar = function(codigo, nickAtacante, indiceAtacante, indiceObjetivo) {
        // Si no se proporcionan índices, usar el primer personaje activo
        if (indiceAtacante === undefined) indiceAtacante = 0;
        if (indiceObjetivo === undefined) indiceObjetivo = 0;
        return this.realizarAccion(codigo, nickAtacante, indiceAtacante, indiceObjetivo);
    }

    this.obtenerPartidasDisponibles=function(){
        let lista=[];
        for(var e in this.partidas){
            let partida = this.partidas[e];
            if (partida.jugadores.length < partida.maxJug){
                lista.push({"codigo":partida.codigo,"owner":partida.jugadores[0].nick});
            }
        }
        return lista;
    }

    this.eliminarPartida = function(codigo, nick) {
        if (this.partidas[codigo]) {
            if (this.partidas[codigo].jugadores.length == 1) {
                if (this.partidas[codigo].jugadores[0].nick == nick) {
                    delete this.partidas[codigo];
                    console.log("Partida eliminada");
                    return {codigo: codigo};
                } else {
                    console.log("No eres el dueño de la partida");
                }
            } else {
                console.log("La partida no se puede eliminar porque hay más de un jugador");
            }
        } else {
            console.log("La partida no existe");
        }
        return {codigo: -1};
    }

    this.obtenerUsuarios = function() {
        return { usuarios: this.usuarios };
    }

    this.usuarioActivo = function(nick) {
        return { res: this.usuarios.hasOwnProperty(nick) };
    }

    this.eliminarUsuario = function(nick) {
        let existia = this.usuarios.hasOwnProperty(nick);
        if (existia) {
            delete this.usuarios[nick];
        }
        return { res: existia };
    }

    this.numeroUsuarios = function() {
        return { num: Object.keys(this.usuarios).length };
    }

    // Inserción/búsqueda de usuario autenticado por Google en la BBDD (CAD)
    this.usuarioGoogle=function(usr,callback){
        let sistema = this;
        this.cad.buscarOCrearUsuario(usr,function(obj){
            // Si el usuario ya estaba en el sistema, actualizarlo con los datos de BD
            // incluyendo el _id para poder hacer updates posteriores
            if (obj && obj.email) {
                // Verificar si ya está en memoria y actualizar
                let enMemoria = sistema.usuarios[obj.email];
                if (enMemoria) {
                    enMemoria._id = obj._id;
                    enMemoria.monedas = obj.monedas;
                    enMemoria.inventario = obj.inventario;
                    enMemoria.equipamiento = obj.equipamiento || [];
                }
            }
            callback(obj);
        });
    }

    // Registro de usuario local (único por email)
    this.registrarUsuario=function(obj,callback){
        let modelo=this;
        obj.email = obj.email.trim();
        if (!obj.nick){ obj.nick = obj.email; }
        // Comprobar existencia solo por email
        this.cad.buscarUsuario({email: obj.email}, function(usr){
            if (!usr){
                obj.key=Date.now().toString();
                obj.confirmada=false;
                modelo.cifrarContraseña(obj.password,function(hash){
                    obj.password=hash;
                    modelo.cad.insertarUsuario(obj,function(res){
                        callback(res);
                    });
                    correo.enviarEmail(obj.email,obj.key,"Confirmar cuenta");
                });
            } else {
                callback({ "email": -1 });
            }
        });
    }

    this.loginUsuario=function(obj,callback){
        let modelo=this;
        this.cad.buscarUsuario({"email":obj.email,"confirmada":true},function(usr){
            if (!usr){
                return callback({"email":-1});
            }
            modelo.compararContraseña(obj.password,usr.password,function(res){
                if(res){
                    // Actualizar en memoria si existe
                    let enMemoria = modelo.usuarios[usr.email];
                    if (enMemoria) {
                        enMemoria._id = usr._id;
                        enMemoria.monedas = usr.monedas;
                        enMemoria.inventario = usr.inventario;
                        enMemoria.equipamiento = usr.equipamiento || [];
                    }
                    callback(usr);
                } else {
                    callback({"email":-1});
                }
            });
        });
    }


    this.confirmarUsuario=function(obj,callback){
            let modelo=this;
            this.cad.buscarUsuario({"email":obj.email,"confirmada":false,"key":obj.key},function(usr){
            if (usr){
                usr.confirmada=true;
                modelo.cad.actualizarUsuario(usr,function(res){
                    callback({"email":res.email}); //callback(res)
                });
            }
            else
            {
                callback({"email":-1});
            }
        });
    }

    // === HERRAMIENTAS DE ADMINISTRADOR ===
    this.injectarPersonaje = function(usuario, nombrePersonaje, cantidad) {
        let animal = data.Animales.find(a => a.nombre === nombrePersonaje);
        if (!animal) return { error: "El personaje no existe" };

        let cant = parseInt(cantidad) || 1;
        let instancia = usuario.inventario.find(i => i.idAnimal === animal.id);

        if (instancia) {
            instancia.copias += cant;
        } else {
            // crearInstanciaPersonaje es una función interna del módulo, accesible aquí
            let nueva = crearInstanciaPersonaje(animal);
            // Si la cantidad es > 1, el resto son copias. Si es 1, copias = 0.
            nueva.copias = Math.max(0, cant - 1);
            usuario.inventario.push(nueva);
        }
        
        // Persistencia
        this.cad.actualizarUsuario(usuario, function(res){});

        return { 
            status: "OK", 
            mensaje: `Se han añadido ${cant} unidades de ${nombrePersonaje} a ${usuario.nick}`,
            animal: animal.nombre
        };
    }

    this.invocarGacha = function(usuario) {
        const costoInvocacion = data.Costos ? data.Costos.invocacionSimple : 100;
        
        if (usuario.monedas < costoInvocacion) {
            return null;
        }

        // Inicializar inventario si no existe
        if (!usuario.inventario) {
            usuario.inventario = [];
        }

        usuario.monedas -= costoInvocacion;

        // Pre-Roll Divino (0.001% para ZENITH = 1 en 100000)
        let zenith = null;
        if (Math.random() < 0.00001) { // 0.001%
            zenith = data.Animales.find(a => a.nombre === "ZENITH");
        }

        let animal;
        let rareza = "";

        if (zenith) {
            animal = zenith;
            rareza = zenith.rareza;
        } else {
            // Determinar rareza según probabilidades (flujo normal)
            let aleatorio = Math.random() * 100;
            // let rareza actual already declared
            const probs = data.ProbabilidadesGacha || { UR: 5, SSR: 15, Raro: 30, Común: 50 };
            
            if (aleatorio < probs.UR) {
                rareza = "UR";
            } else if (aleatorio < probs.UR + probs.SSR) {
                rareza = "SSR";
            } else if (aleatorio < probs.UR + probs.SSR + probs.Raro) {
                rareza = "Raro";
            } else {
                rareza = "Común";
            }

            // Seleccionar animal aleatorio de la rareza
            let animalesPosibles = data.Animales.filter(a => a.rareza == rareza);
            animal = animalesPosibles[Math.floor(Math.random() * animalesPosibles.length)];
        }

        // Buscar si el usuario ya tiene este personaje (mismo idAnimal)
        let instanciaExistente = usuario.inventario.find(inst => inst.idAnimal === animal.id);
        let esDuplicado = false;

        if (instanciaExistente) {
            // Si ya lo tiene, incrementar copias
            instanciaExistente.copias++;
            esDuplicado = true;
        } else {
            // Si no lo tiene, crear nueva instancia
            let nuevaInstancia = crearInstanciaPersonaje(animal);
            usuario.inventario.push(nuevaInstancia);
        }

        // Guardar en BBDD el objeto completo (inventario con instancias)
        if (this.cad.actualizarInventario) {
             this.cad.actualizarInventario(usuario, function(res){ 
                console.log("Inventario y monedas guardados"); 
             });
        }
        
        // Retornar información completa del resultado
        return {
            animal: animal,
            esDuplicado: esDuplicado,
            instancia: instanciaExistente || usuario.inventario[usuario.inventario.length - 1]
        };
    }

    // Invocación múltiple (x10) con descuento
    this.invocarGachaMultiple = function(usuario) {
        const costoMultiple = data.Costos ? data.Costos.invocacionMultiple : 900;
        
        if (usuario.monedas < costoMultiple) {
            return null;
        }

        // Inicializar inventario si no existe
        if (!usuario.inventario) {
            usuario.inventario = [];
        }

        usuario.monedas -= costoMultiple;
        let resultados = [];

        for (let i = 0; i < 10; i++) {
            // Pre-Roll Divino (0.001% para ZENITH = 1 en 100000) en cada tirada
            let zenith = null;
            if (Math.random() < 0.00001) { // 0.001%
                zenith = data.Animales.find(a => a.nombre === "ZENITH");
            }
            
            let animal;
            let rareza = "";
            
            if (zenith) {
                animal = zenith;
                rareza = zenith.rareza;
            } else {
                // Determinar rareza según probabilidades
                let aleatorio = Math.random() * 100;
                const probs = data.ProbabilidadesGacha || { UR: 5, SSR: 15, Raro: 30, Común: 50 };
                
                if (aleatorio < probs.UR) {
                    rareza = "UR";
                } else if (aleatorio < probs.UR + probs.SSR) {
                    rareza = "SSR";
                } else if (aleatorio < probs.UR + probs.SSR + probs.Raro) {
                    rareza = "Raro";
                } else {
                    rareza = "Común";
                }

                // Seleccionar animal aleatorio de la rareza
                let animalesPosibles = data.Animales.filter(a => a.rareza == rareza);
                animal = animalesPosibles[Math.floor(Math.random() * animalesPosibles.length)];
            }

            // Buscar si el usuario ya tiene este personaje
            let instanciaExistente = usuario.inventario.find(inst => inst.idAnimal === animal.id);
            let esDuplicado = false;

            if (instanciaExistente) {
                instanciaExistente.copias++;
                esDuplicado = true;
                resultados.push({
                    animal: animal,
                    esDuplicado: true,
                    instancia: instanciaExistente
                });
            } else {
                let nuevaInstancia = crearInstanciaPersonaje(animal);
                usuario.inventario.push(nuevaInstancia);
                resultados.push({
                    animal: animal,
                    esDuplicado: false,
                    instancia: nuevaInstancia
                });
            }
        }

        // Guardar en BBDD
        if (this.cad.actualizarInventario) {
             this.cad.actualizarInventario(usuario, function(res){ 
                console.log("Inventario x10 y monedas guardados"); 
             });
        }
        
        return resultados;
    }

    // Invocación masiva (x100) con mayor descuento
    this.invocarGachaCien = function(usuario) {
        const costoCien = data.Costos ? data.Costos.invocacionCien : 8000;
        
        if (usuario.monedas < costoCien) {
            return null;
        }

        // Inicializar inventario si no existe
        if (!usuario.inventario) {
            usuario.inventario = [];
        }

        usuario.monedas -= costoCien;
        let resultados = [];

        for (let i = 0; i < 100; i++) {
            // Pre-Roll Divino (0.001% para ZENITH = 1 en 100000) en cada tirada
            let zenith = null;
            if (Math.random() < 0.00001) { // 0.001%
                zenith = data.Animales.find(a => a.nombre === "ZENITH");
            }
            
            let animal;
            let rareza = "";
            
            if (zenith) {
                animal = zenith;
                rareza = zenith.rareza;
            } else {
                // Determinar rareza según probabilidades
                let aleatorio = Math.random() * 100;
                const probs = data.ProbabilidadesGacha || { UR: 0.5, SSR: 3.5, Raro: 20, Común: 76 };
                
                if (aleatorio < probs.UR) {
                    rareza = "UR";
                } else if (aleatorio < probs.UR + probs.SSR) {
                    rareza = "SSR";
                } else if (aleatorio < probs.UR + probs.SSR + probs.Raro) {
                    rareza = "Raro";
                } else {
                    rareza = "Común";
                }

                // Seleccionar animal aleatorio de la rareza
                let animalesPosibles = data.Animales.filter(a => a.rareza == rareza);
                animal = animalesPosibles[Math.floor(Math.random() * animalesPosibles.length)];
            }

            // Buscar si el usuario ya tiene este personaje
            let instanciaExistente = usuario.inventario.find(inst => inst.idAnimal === animal.id);
            let esDuplicado = false;

            if (instanciaExistente) {
                instanciaExistente.copias++;
                esDuplicado = true;
                resultados.push({
                    animal: animal,
                    esDuplicado: true,
                    instancia: instanciaExistente
                });
            } else {
                let nuevaInstancia = crearInstanciaPersonaje(animal);
                usuario.inventario.push(nuevaInstancia);
                resultados.push({
                    animal: animal,
                    esDuplicado: false,
                    instancia: nuevaInstancia
                });
            }
        }

        // Guardar en BBDD
        if (this.cad.actualizarInventario) {
             this.cad.actualizarInventario(usuario, function(res){ 
                console.log("Inventario x100 y monedas guardados"); 
             });
        }
        
        return resultados;
    }

    // ==============================================================================
    // ==================== SISTEMA DE EQUIPAMIENTO v1.0 ====================
    // ==============================================================================

    // Generador de ID único para ítems
    let itemIdCounter = Date.now();
    function generarItemId() {
        return 'item_' + (itemIdCounter++) + '_' + Math.random().toString(36).substr(2, 9);
    }

    // Nombres base para generación procedural
    const PREFIJOS_ITEM = {
        Fuego: ["Ígneo", "Flamígero", "Ardiente", "Volcánico", "Infernal"],
        Agua: ["Marino", "Glacial", "Oceánico", "Torrencial", "Cristalino"],
        Tierra: ["Pétreo", "Terrenal", "Montañés", "Sísmico", "Mineral"],
        Aire: ["Etéreo", "Ventoso", "Celestial", "Tempestuoso", "Nuboso"],
        Luz: ["Radiante", "Luminoso", "Solar", "Divino", "Áureo"],
        Oscuridad: ["Sombrío", "Nocturno", "Tenebroso", "Abismal", "Umbral"]
    };

    const SUFIJOS_RAREZA = {
        Común: ["", "Simple", "Básico"],
        Raro: ["Refinado", "Forjado", "Encantado"],
        SSR: ["Legendario", "Mítico", "Supremo", "Ancestral"]
    };

    /**
     * Genera el nombre de un ítem basándose en su tipo, elemento y rareza
     */
    function generarNombreItem(tipo, elemento, rareza) {
        const prefijos = PREFIJOS_ITEM[elemento] || ["Misterioso"];
        const sufijos = SUFIJOS_RAREZA[rareza] || [""];
        
        const prefijo = prefijos[Math.floor(Math.random() * prefijos.length)];
        const sufijo = sufijos[Math.floor(Math.random() * sufijos.length)];
        
        if (sufijo) {
            return `${tipo} ${prefijo} ${sufijo}`;
        }
        return `${tipo} ${prefijo}`;
    }

    /**
     * Calcula los stats de un ítem según tipo y rareza
     * Siguiendo las reglas EXACTAS especificadas
     */
    function calcularStatsItem(tipo, rareza) {
        // Estructura con bonos individuales por stat
        // tipoBonoAtaque, tipoBonoDefensa, tipoBonoVida: 'plano' | 'porcentaje'
        let stats = {
            ataque: 0,
            defensa: 0,
            vida: 0,
            tipoBonoAtaque: 'plano',
            tipoBonoDefensa: 'plano',
            tipoBonoVida: 'plano'
        };

        switch (tipo) {
            case "Casco":
                // Principal: Vida
                if (rareza === "Común") {
                    // Solo stat principal, plano
                    stats.vida = 10;
                    stats.tipoBonoVida = 'plano';
                } else if (rareza === "Raro") {
                    // Principal porcentaje, secundarias planas
                    stats.vida = 20;
                    stats.tipoBonoVida = 'porcentaje';
                    stats.defensa = 5;
                    stats.tipoBonoDefensa = 'plano';
                    stats.ataque = 5;
                    stats.tipoBonoAtaque = 'plano';
                } else if (rareza === "SSR") {
                    // Todas porcentuales
                    stats.vida = 50;
                    stats.tipoBonoVida = 'porcentaje';
                    stats.defensa = 25;
                    stats.tipoBonoDefensa = 'porcentaje';
                    stats.ataque = 25;
                    stats.tipoBonoAtaque = 'porcentaje';
                }
                break;

            case "Pechera":
            case "Pantalones":
                // Principal: Defensa
                if (rareza === "Común") {
                    stats.defensa = 10;
                    stats.tipoBonoDefensa = 'plano';
                } else if (rareza === "Raro") {
                    stats.defensa = 20;
                    stats.tipoBonoDefensa = 'porcentaje';
                    stats.vida = 5;
                    stats.tipoBonoVida = 'plano';
                    stats.ataque = 5;
                    stats.tipoBonoAtaque = 'plano';
                } else if (rareza === "SSR") {
                    stats.defensa = 50;
                    stats.tipoBonoDefensa = 'porcentaje';
                    stats.vida = 25;
                    stats.tipoBonoVida = 'porcentaje';
                    stats.ataque = 25;
                    stats.tipoBonoAtaque = 'porcentaje';
                }
                break;

            case "Zapatos":
                // Principal: Ataque
                if (rareza === "Común") {
                    stats.ataque = 10;
                    stats.tipoBonoAtaque = 'plano';
                } else if (rareza === "Raro") {
                    stats.ataque = 20;
                    stats.tipoBonoAtaque = 'porcentaje';
                    stats.vida = 5;
                    stats.tipoBonoVida = 'plano';
                    stats.defensa = 5;
                    stats.tipoBonoDefensa = 'plano';
                } else if (rareza === "SSR") {
                    stats.ataque = 50;
                    stats.tipoBonoAtaque = 'porcentaje';
                    stats.vida = 25;
                    stats.tipoBonoVida = 'porcentaje';
                    stats.defensa = 25;
                    stats.tipoBonoDefensa = 'porcentaje';
                }
                break;

            case "Arma":
                // Solo Ataque
                if (rareza === "Común") {
                    stats.ataque = 50;
                    stats.tipoBonoAtaque = 'plano';
                } else if (rareza === "Raro") {
                    stats.ataque = 50;
                    stats.tipoBonoAtaque = 'porcentaje';
                } else if (rareza === "SSR") {
                    stats.ataque = 100;
                    stats.tipoBonoAtaque = 'porcentaje';
                }
                break;
        }

        return stats;
    }

    /**
     * Crea un ítem aleatorio con todas las propiedades
     * @returns {Object} Ítem generado
     */
    function crearItemAleatorio() {
        const tipos = data.TiposEquipamiento || ["Casco", "Pechera", "Pantalones", "Zapatos", "Arma"];
        const elementos = data.ElementosEquipamiento || ["Fuego", "Agua", "Tierra", "Aire", "Luz", "Oscuridad"];
        const probs = data.ProbabilidadesEquipamiento || {
            rareza: { Común: 50, Raro: 47.5, SSR: 2.5 },
            elemento: { Fuego: 20, Agua: 20, Tierra: 20, Aire: 20, Luz: 10, Oscuridad: 10 }
        };

        // Determinar tipo (equiprobable)
        const tipo = tipos[Math.floor(Math.random() * tipos.length)];

        // Determinar elemento según probabilidades
        let elemento = "Fuego";
        let randElemento = Math.random() * 100;
        let acumuladoElemento = 0;
        for (let elem of elementos) {
            acumuladoElemento += probs.elemento[elem] || (100 / elementos.length);
            if (randElemento < acumuladoElemento) {
                elemento = elem;
                break;
            }
        }

        // Determinar rareza según probabilidades
        let rareza = "Común";
        let randRareza = Math.random() * 100;
        if (randRareza < probs.rareza.SSR) {
            rareza = "SSR";
        } else if (randRareza < probs.rareza.SSR + probs.rareza.Raro) {
            rareza = "Raro";
        } else {
            rareza = "Común";
        }

        // Generar stats según tipo y rareza
        const stats = calcularStatsItem(tipo, rareza);

        // Generar nombre
        const nombre = generarNombreItem(tipo, elemento, rareza);

        // Generar ruta de imagen genérica (sin elemento)
        // Mapeamos tipo a nombre de archivo existente
        const tipoToImagen = {
            'Casco': 'casco',
            'Pechera': 'pechera',
            'Pantalones': 'pantalones',
            'Zapatos': 'botas',
            'Arma': 'espada'
        };
        const nombreImagen = tipoToImagen[tipo] || 'casco';
        const img = `/cliente/img/${nombreImagen}.png`;

        return {
            id: generarItemId(),
            nombre: nombre,
            tipo: tipo,
            elemento: elemento,
            rareza: rareza,
            stats: stats,
            img: img
        };
    }

    /**
     * Invocación de equipamiento (gacha de ítems)
     * @param {Object} usuario - Usuario que invoca
     * @param {number} cantidad - Cantidad de ítems a invocar (1, 10, o 100)
     * @returns {Object} Resultado de la invocación con items o error
     */
    this.invocarEquipamiento = function(usuario, cantidad = 1) {
        // Determinar costo según cantidad
        let costo;
        if (cantidad === 100) {
            costo = data.Costos ? data.Costos.equipamientoCien : 16000;
        } else if (cantidad === 10) {
            costo = data.Costos ? data.Costos.equipamientoMultiple : 1800;
        } else {
            costo = data.Costos ? data.Costos.equipamientoSimple : 200;
            cantidad = 1; // Forzar cantidad a 1 para invocación simple
        }

        // Verificar monedas
        if (usuario.monedas < costo) {
            return null;
        }

        // Inicializar array de equipamiento si no existe
        if (!usuario.equipamiento) {
            usuario.equipamiento = [];
        }

        // Verificar límite de inventario
        const maxEquipamiento = data.LimitesInventario ? data.LimitesInventario.maxEquipamiento : 300;
        const espacioDisponible = maxEquipamiento - usuario.equipamiento.length;
        
        if (espacioDisponible < cantidad) {
            return { 
                errorInventario: true, 
                mensaje: `No tienes espacio suficiente. Tienes ${usuario.equipamiento.length}/${maxEquipamiento} items. Necesitas ${cantidad} espacios libres.`,
                espacioDisponible: espacioDisponible,
                cantidadRequerida: cantidad
            };
        }

        // Descontar monedas
        usuario.monedas -= costo;

        // Generar ítems
        let itemsObtenidos = [];
        for (let i = 0; i < cantidad; i++) {
            const nuevoItem = crearItemAleatorio();
            usuario.equipamiento.push(nuevoItem);
            itemsObtenidos.push(nuevoItem);
        }

        // Guardar en BBDD
        if (this.cad.actualizarEquipamiento) {
            this.cad.actualizarEquipamiento(usuario, function(res) {
                console.log(`Equipamiento x${cantidad} guardado`);
            });
        } else if (this.cad.actualizarInventario) {
            // Fallback: usar actualizarInventario que guarda todo
            this.cad.actualizarInventario(usuario, function(res) {
                console.log(`Equipamiento x${cantidad} guardado (via inventario)`);
            });
        }

        return itemsObtenidos;
    }

    /**
     * Obtener todo el equipamiento de un usuario
     * @param {Object} usuario - Usuario
     * @returns {Array} Array de ítems del usuario
     */
    this.obtenerEquipamiento = function(usuario) {
        if (!usuario.equipamiento) {
            usuario.equipamiento = [];
        }
        return usuario.equipamiento;
    }

    /**
     * Obtener información del inventario de equipamiento
     * @param {Object} usuario - Usuario
     * @returns {Object} Información del inventario
     */
    this.obtenerInfoInventarioEquipamiento = function(usuario) {
        if (!usuario.equipamiento) {
            usuario.equipamiento = [];
        }
        const maxEquipamiento = data.LimitesInventario ? data.LimitesInventario.maxEquipamiento : 300;
        return {
            actual: usuario.equipamiento.length,
            maximo: maxEquipamiento,
            espacioLibre: maxEquipamiento - usuario.equipamiento.length
        };
    }

    /**
     * Eliminar un ítem de equipamiento y recompensar al usuario
     * @param {Object} usuario - Usuario
     * @param {string} itemId - ID del ítem a eliminar
     * @returns {Object} Resultado de la operación
     */
    this.eliminarEquipamiento = function(usuario, itemId) {
        if (!usuario.equipamiento) {
            return { error: true, mensaje: "No tienes equipamiento" };
        }

        // Buscar el ítem
        const itemIndex = usuario.equipamiento.findIndex(i => i.id === itemId);
        if (itemIndex === -1) {
            return { error: true, mensaje: "Ítem no encontrado" };
        }

        const item = usuario.equipamiento[itemIndex];

        // Verificar si está equipado en algún personaje
        if (item.equipadoEn) {
            // Desequipar primero
            const personaje = usuario.inventario?.find(p => p.uid === item.equipadoEn);
            if (personaje && personaje.equipo) {
                const slot = item.tipo.toLowerCase();
                personaje.equipo[slot] = null;
            }
        }

        // Eliminar el ítem del array
        usuario.equipamiento.splice(itemIndex, 1);

        // Recompensar al usuario
        const recompensa = data.LimitesInventario ? data.LimitesInventario.recompensaEliminar : 25;
        usuario.monedas += recompensa;

        // Guardar cambios en BBDD
        if (this.cad.actualizarInventario) {
            this.cad.actualizarInventario(usuario, function(res) {
                console.log(`Equipamiento eliminado. +${recompensa} monedas`);
            });
        }

        const maxEquipamiento = data.LimitesInventario ? data.LimitesInventario.maxEquipamiento : 300;

        return {
            exito: true,
            mensaje: `Has eliminado "${item.nombre}" y recibido ${recompensa} monedas`,
            recompensa: recompensa,
            monedasActuales: usuario.monedas,
            itemEliminado: item.nombre,
            inventarioActual: usuario.equipamiento.length,
            inventarioMaximo: maxEquipamiento
        };
    }

    /**
     * Equipar un ítem a un personaje
     * @param {Object} usuario - Usuario
     * @param {string} itemId - ID del ítem a equipar
     * @param {string} personajeUid - UID del personaje
     * @returns {Object} Resultado de la operación
     */
    this.equiparItem = function(usuario, itemId, personajeUid) {
        // Buscar el ítem en el equipamiento del usuario
        const item = usuario.equipamiento?.find(i => i.id === itemId);
        if (!item) {
            return { error: true, mensaje: "Ítem no encontrado" };
        }

        // Buscar el personaje en el inventario
        const personaje = usuario.inventario?.find(p => p.uid === personajeUid);
        if (!personaje) {
            return { error: true, mensaje: "Personaje no encontrado" };
        }

        // Inicializar slots de equipamiento del personaje si no existen
        if (!personaje.equipo) {
            personaje.equipo = {
                casco: null,
                pechera: null,
                pantalones: null,
                zapatos: null,
                arma: null
            };
        }

        // Determinar el slot según el tipo de ítem
        const slot = item.tipo.toLowerCase();
        
        // Si ya hay un ítem en ese slot, desequiparlo primero
        if (personaje.equipo[slot]) {
            const itemAnteriorId = typeof personaje.equipo[slot] === 'string' 
                ? personaje.equipo[slot] 
                : personaje.equipo[slot].id || personaje.equipo[slot];
            const itemAnterior = usuario.equipamiento?.find(i => i.id === itemAnteriorId);
            if (itemAnterior) {
                itemAnterior.equipadoEn = null;
            }
        }

        // Desequipar el ítem de su personaje anterior si estaba equipado
        if (item.equipadoEn) {
            const personajeAnterior = usuario.inventario?.find(p => p.uid === item.equipadoEn);
            if (personajeAnterior && personajeAnterior.equipo) {
                personajeAnterior.equipo[slot] = null;
            }
        }

        // Equipar el nuevo ítem - guardar el OBJETO completo para referencia inmediata
        // y también guardar la relación en el item
        personaje.equipo[slot] = {
            id: item.id,
            nombre: item.nombre,
            tipo: item.tipo,
            elemento: item.elemento,
            rareza: item.rareza,
            img: item.img,
            stats: item.stats
        };
        item.equipadoEn = personajeUid;

        // Guardar cambios (incluye tanto inventario como equipamiento)
        if (this.cad.actualizarInventario) {
            this.cad.actualizarInventario(usuario, function(res) {
                console.log("Inventario y equipamiento actualizados");
            });
        }

        return { 
            exito: true, 
            mensaje: `${item.nombre} equipado a ${personaje.nombre || 'personaje'}`,
            item: item,
            personaje: personaje,
            equipo: personaje.equipo
        };
    }

    /**
     * Desequipar un ítem de un personaje
     * @param {Object} usuario - Usuario
     * @param {string} itemId - ID del ítem a desequipar
     * @returns {Object} Resultado de la operación
     */
    this.desequiparItem = function(usuario, itemId) {
        // Buscar el ítem
        const item = usuario.equipamiento?.find(i => i.id === itemId);
        if (!item) {
            return { error: true, mensaje: "Ítem no encontrado" };
        }

        if (!item.equipadoEn) {
            return { error: true, mensaje: "El ítem no está equipado" };
        }

        // Buscar el personaje
        const personaje = usuario.inventario?.find(p => p.uid === item.equipadoEn);
        if (personaje && personaje.equipo) {
            const slot = item.tipo.toLowerCase();
            personaje.equipo[slot] = null;
        }

        item.equipadoEn = null;

        // Guardar cambios
        if (this.cad.actualizarInventario) {
            this.cad.actualizarInventario(usuario, function(res) {
                console.log("Ítem desequipado");
            });
        }

        return { exito: true, mensaje: `${item.nombre} desequipado`, item: item };
    }

    /**
     * Calcular stats totales de un personaje incluyendo equipamiento
     * @param {Object} personaje - Instancia del personaje
     * @param {Object} statsBase - Stats base del animal
     * @returns {Object} Stats totales calculados
     */
    this.calcularStatsConEquipamiento = function(personaje, statsBase) {
        let stats = {
            ataque: personaje.stats?.ataque || statsBase.ataque || 100,
            defensa: personaje.stats?.defensa || statsBase.defensa || 50,
            vida: personaje.stats?.vida || statsBase.vida || 500
        };

        if (!personaje.equipo) {
            return stats;
        }

        // Acumular bonos planos y porcentuales por separado
        let bonosPlanos = { ataque: 0, defensa: 0, vida: 0 };
        let bonosPorcentaje = { ataque: 0, defensa: 0, vida: 0 };

        // Iterar sobre todos los slots de equipamiento
        const slots = ['casco', 'pechera', 'pantalones', 'zapatos', 'arma'];
        for (let slot of slots) {
            const item = personaje.equipo[slot];
            if (!item || !item.stats) continue;

            if (item.stats.tipoBono === 'porcentaje') {
                bonosPorcentaje.ataque += item.stats.ataque || 0;
                bonosPorcentaje.defensa += item.stats.defensa || 0;
                bonosPorcentaje.vida += item.stats.vida || 0;
            } else {
                bonosPlanos.ataque += item.stats.ataque || 0;
                bonosPlanos.defensa += item.stats.defensa || 0;
                bonosPlanos.vida += item.stats.vida || 0;
            }
        }

        // Aplicar bonos: Primero planos, luego porcentuales sobre el total
        stats.ataque += bonosPlanos.ataque;
        stats.defensa += bonosPlanos.defensa;
        stats.vida += bonosPlanos.vida;

        stats.ataque = Math.floor(stats.ataque * (1 + bonosPorcentaje.ataque / 100));
        stats.defensa = Math.floor(stats.defensa * (1 + bonosPorcentaje.defensa / 100));
        stats.vida = Math.floor(stats.vida * (1 + bonosPorcentaje.vida / 100));

        return stats;
    }

    /**
     * Calcular stats totales incluyendo equipamiento CON SINERGIA ELEMENTAL
     * REGLA DE ORO: Si objeto.elemento === personaje.tipo → x2 en stats del objeto
     * @param {Object} statsBase - Stats base del personaje {ataque, defensa, vida}
     * @param {Object} equipo - Objeto con slots: {casco, pechera, pantalones, zapatos, arma}
     * @param {string} tipoPersonaje - Tipo elemental del personaje (Fuego, Agua, etc.)
     * @returns {Object} Stats finales calculados
     */
    this.calcularStatsConEquipamientoYSinergia = function(statsBase, equipo, tipoPersonaje) {
        // Empezar con stats base
        let stats = {
            ataque: statsBase.ataque || 100,
            defensa: statsBase.defensa || 50,
            vida: statsBase.vida || 500
        };

        // Si no hay equipamiento, devolver stats base
        if (!equipo) {
            return stats;
        }

        // Acumular bonos planos y porcentuales por separado
        let bonosPlanos = { ataque: 0, defensa: 0, vida: 0 };
        let bonosPorcentaje = { ataque: 0, defensa: 0, vida: 0 };

        // Iterar sobre todos los slots de equipamiento
        const slots = ['casco', 'pechera', 'pantalones', 'zapatos', 'arma'];
        for (let slot of slots) {
            const item = equipo[slot];
            if (!item || !item.stats) continue;

            // SINERGIA ELEMENTAL: Si el elemento del objeto coincide con el tipo del personaje
            // los stats de ese objeto se MULTIPLICAN x2
            const multiplicadorSinergia = (item.elemento === tipoPersonaje) ? 2 : 1;

            // Nueva estructura: cada stat tiene su propio tipoBono
            // tipoBonoAtaque, tipoBonoDefensa, tipoBonoVida
            const atkVal = (item.stats.ataque || 0) * multiplicadorSinergia;
            const defVal = (item.stats.defensa || 0) * multiplicadorSinergia;
            const vidaVal = (item.stats.vida || 0) * multiplicadorSinergia;

            // Ataque
            if (item.stats.tipoBonoAtaque === 'porcentaje') {
                bonosPorcentaje.ataque += atkVal;
            } else {
                bonosPlanos.ataque += atkVal;
            }

            // Defensa
            if (item.stats.tipoBonoDefensa === 'porcentaje') {
                bonosPorcentaje.defensa += defVal;
            } else {
                bonosPlanos.defensa += defVal;
            }

            // Vida
            if (item.stats.tipoBonoVida === 'porcentaje') {
                bonosPorcentaje.vida += vidaVal;
            } else {
                bonosPlanos.vida += vidaVal;
            }
        }

        // ORDEN DE APLICACIÓN:
        // 1. Primero sumar bonos planos a la base
        stats.ataque += bonosPlanos.ataque;
        stats.defensa += bonosPlanos.defensa;
        stats.vida += bonosPlanos.vida;

        // 2. Luego aplicar bonos porcentuales sobre el total (base + planos)
        stats.ataque = Math.floor(stats.ataque * (1 + bonosPorcentaje.ataque / 100));
        stats.defensa = Math.floor(stats.defensa * (1 + bonosPorcentaje.defensa / 100));
        stats.vida = Math.floor(stats.vida * (1 + bonosPorcentaje.vida / 100));

        return stats;
    }

    // ==============================================================================
    // ==================== FIN SISTEMA DE EQUIPAMIENTO ====================
    // ==============================================================================

    this.obtenerInventario = function(usuario) {
        const rangos = data.RangosBase || [];
        const limites = data.LimiteEvolucionPorRareza || {};
        let inventarioCompleto = [];
        
        // Verificar que el usuario tenga inventario
        if (!usuario || !usuario.inventario) {
            return inventarioCompleto;
        }
        
        for(let i=0; i<usuario.inventario.length; i++){
            let instancia = usuario.inventario[i];
            let animal = data.Animales.find(a => a.id == instancia.idAnimal);
            if (animal) {
                // Compatibilidad: si no tiene los nuevos campos, inicializarlos
                if (!instancia.rangoBase) {
                    instancia.rangoBase = instancia.rango || "Estrellas";
                }
                if (!instancia.nivelRango) {
                    instancia.nivelRango = 1;
                }
                
                // Calcular poder si no existe
                let poder = instancia.poder;
                if (!poder) {
                    poder = calcularPoder(instancia.stats);
                    instancia.poder = poder;
                }
                
                // Obtener info del rango
                const indiceRango = rangos.findIndex(r => r.nombre === instancia.rangoBase);
                const rangoInfo = rangos[indiceRango] || { icono: '⭐', nombre: 'Estrellas' };
                
                // Obtener límite de evolución según rareza
                const limiteRango = limites[animal.rareza] !== undefined ? limites[animal.rareza] : 7;
                const esMaximo = indiceRango >= limiteRango && instancia.nivelRango >= 6;
                
                // Combinar datos base del animal con la instancia del usuario
                inventarioCompleto.push({
                    // Datos de la instancia
                    uid: instancia.uid,
                    nivel: instancia.nivel,
                    rangoBase: instancia.rangoBase,
                    nivelRango: instancia.nivelRango,
                    rango: instancia.rango, // Compatibilidad
                    copias: instancia.copias,
                    stats: instancia.stats,
                    poder: poder,
                    // Equipamiento del personaje
                    equipo: instancia.equipo || null,
                    // Info de rango visual
                    rangoIcono: rangoInfo.icono,
                    rangoTexto: `${rangoInfo.icono} ${instancia.rangoBase} ${instancia.nivelRango}`,
                    esMaximo: esMaximo,
                    limiteRango: limiteRango,
                    // Datos base del animal
                    idAnimal: animal.id,
                    nombre: animal.nombre,
                    tipo: animal.tipo,
                    rareza: animal.rareza,
                    img: animal.img,
                    // === v2.0: Habilidades ===
                    velocidad: animal.velocidad || 50,
                    pasiva: animal.pasiva || null,
                    ultimate: animal.ultimate || null,
                    // Stats base para referencia
                    statsBase: {
                        ataque: animal.ataque,
                        defensa: animal.defensa,
                        vida: animal.vida
                    }
                });
            }
        }
        
        // Ordenar por PODER (más fuerte primero)
        inventarioCompleto.sort((a, b) => b.poder - a.poder);
        
        return inventarioCompleto;
    }
    
    // Calcula el PODER del usuario (suma de los 3 personajes más fuertes)
    this.calcularPoderUsuario = function(usuario) {
        const inventario = this.obtenerInventario(usuario);
        // Ya viene ordenado por poder, tomar los 3 primeros
        const top3 = inventario.slice(0, 3);
        const poderTotal = top3.reduce((sum, p) => sum + p.poder, 0);
        return {
            poderTotal: poderTotal,
            top3: top3.map(p => ({ nombre: p.nombre, poder: p.poder, rangoTexto: p.rangoTexto }))
        };
    }

    // Evolucionar personaje si tiene suficientes copias
    this.evolucionarPersonaje = function(usuario, uid) {
        let instancia = usuario.inventario.find(inst => inst.uid === uid);
        if (!instancia) {
            return { exito: false, mensaje: "Personaje no encontrado" };
        }

        let animal = data.Animales.find(a => a.id == instancia.idAnimal);
        if (!animal) {
            return { exito: false, mensaje: "Animal no encontrado" };
        }

        // EXCEPCIÓN ZENITH - Evolución final a ETERNO tras Infinito 6
        if (animal.nombre === "ZENITH") {
            if (instancia.rangoBase === "ETERNO" && instancia.nivelRango >= 6) {
                return { exito: false, mensaje: "ZENITH ya domina el estado ETERNO 6." };
            }

            const rangoActualZenith = instancia.rangoBase || instancia.rango || "Estrellas";
            const nivelActualZenith = instancia.nivelRango || 1;
            const alcanzadoInfinitoMax = (rangoActualZenith === "Infinito" && nivelActualZenith >= 6);

            if (alcanzadoInfinitoMax) {
                if ((instancia.copias || 0) >= 1) {
                    instancia.copias -= 1;
                    instancia.rangoBase = "ETERNO";
                    instancia.nivelRango = 1;
                    instancia.rango = "ETERNO";
                    instancia.stats = calcularStats(animal, instancia.nivel, instancia.rangoBase, instancia.nivelRango);
                    instancia.poder = calcularPoder(instancia.stats);
                    return { exito: true, mensaje: "¡ZENITH trasciende a la forma ETERNA!", nuevoRango: "ETERNO", instancia: instancia };
                }
                return { exito: false, mensaje: "ZENITH necesita 1 copia adicional para alcanzar ETERNO." };
            }
            // Si aún no está en Infinito 6, continuar con la lógica normal para subir como UR
        }

        const rangos = data.RangosBase || [];
        const limites = data.LimiteEvolucionPorRareza || {};
        const copiasSubirNivel = data.CopiasParaSubirNivel || 1;
        const copiasCambiarRango = data.CopiasParaCambiarRango || 2;
        
        // Compatibilidad: si no tiene los nuevos campos, inicializarlos
        if (!instancia.rangoBase) {
            instancia.rangoBase = instancia.rango || "Estrellas";
        }
        if (!instancia.nivelRango) {
            instancia.nivelRango = 1;
        }
        
        // Encontrar índice del rango actual
        let indiceRangoActual = rangos.findIndex(r => r.nombre === instancia.rangoBase);
        if (indiceRangoActual < 0) indiceRangoActual = 0;
        
        // Obtener límite de evolución según rareza
        const limiteRango = limites[animal.rareza] !== undefined ? limites[animal.rareza] : 7;
        
        // Verificar si está en el máximo absoluto
        if (indiceRangoActual >= limiteRango && instancia.nivelRango >= 6) {
            return { 
                exito: false, 
                mensaje: `¡Rango máximo para ${animal.rareza}! (${rangos[limiteRango].icono} ${rangos[limiteRango].nombre} 6)` 
            };
        }
        
        // Determinar qué tipo de evolución hacer
        let tipoEvolucion = "";
        let copiasRequeridas = 0;
        let nuevoRangoBase = instancia.rangoBase;
        let nuevoNivelRango = instancia.nivelRango;
        
        if (instancia.nivelRango < 6) {
            // Subir nivel dentro del rango (1→2, 2→3, etc.)
            tipoEvolucion = "nivel";
            copiasRequeridas = copiasSubirNivel;
            nuevoNivelRango = instancia.nivelRango + 1;
        } else if (indiceRangoActual < limiteRango) {
            // Cambiar de rango (6 estrellas → 1 luna)
            tipoEvolucion = "rango";
            copiasRequeridas = copiasCambiarRango;
            nuevoRangoBase = rangos[indiceRangoActual + 1].nombre;
            nuevoNivelRango = 1;
        } else {
            return { 
                exito: false, 
                mensaje: `¡Rango máximo para ${animal.rareza}!` 
            };
        }

        if (animal.nombre === "ZENITH" && tipoEvolucion === "rango" && nuevoRangoBase === "ETERNO") {
            copiasRequeridas = 1;
        }
        
        // Verificar copias
        if (instancia.copias < copiasRequeridas) {
            const rangoActualInfo = rangos[indiceRangoActual];
            let siguienteTexto = "";
            if (tipoEvolucion === "nivel") {
                siguienteTexto = `${rangoActualInfo.icono} ${instancia.rangoBase} ${nuevoNivelRango}`;
            } else {
                const rangoSiguiente = rangos[indiceRangoActual + 1];
                siguienteTexto = `${rangoSiguiente.icono} ${rangoSiguiente.nombre} 1`;
            }
            return { 
                exito: false, 
                mensaje: `Necesitas ${copiasRequeridas} copia${copiasRequeridas > 1 ? 's' : ''} para evolucionar a ${siguienteTexto}. Tienes ${instancia.copias}.` 
            };
        }

        // Guardar stats anteriores para mostrar comparación
        let statsAnteriores = { ...instancia.stats };
        let poderAnterior = instancia.poder || calcularPoder(statsAnteriores);
        let rangoAnterior = `${rangos[indiceRangoActual].icono} ${instancia.rangoBase} ${instancia.nivelRango}`;
        
        // Realizar evolución
        instancia.copias -= copiasRequeridas;
        instancia.rangoBase = nuevoRangoBase;
        instancia.nivelRango = nuevoNivelRango;
        // Mantener compatibilidad con campo 'rango' antiguo
        instancia.rango = nuevoRangoBase;
        
        // Recalcular stats
        instancia.stats = calcularStats(animal, instancia.nivel, instancia.rangoBase, instancia.nivelRango);
        instancia.poder = calcularPoder(instancia.stats);
        
        // Calcular mejoras
        let mejoras = {
            ataque: instancia.stats.ataque - statsAnteriores.ataque,
            defensa: instancia.stats.defensa - statsAnteriores.defensa,
            vida: instancia.stats.vida - statsAnteriores.vida,
            poder: instancia.poder - poderAnterior
        };

        // Guardar en BBDD
        if (this.cad.actualizarInventario) {
            this.cad.actualizarInventario(usuario, function(res){ 
                console.log("Evolución guardada"); 
            });
        }
        
        // Obtener icono del nuevo rango
        const nuevoIndiceRango = rangos.findIndex(r => r.nombre === nuevoRangoBase);
        const iconoNuevo = rangos[nuevoIndiceRango] ? rangos[nuevoIndiceRango].icono : '⭐';
        const rangoNuevoTexto = `${iconoNuevo} ${nuevoRangoBase} ${nuevoNivelRango}`;

        return { 
            exito: true, 
            mensaje: `¡Evolucionado a ${rangoNuevoTexto}!`,
            instancia: instancia,
            rangoAnterior: rangoAnterior,
            rangoNuevo: rangoNuevoTexto,
            statsAnteriores: statsAnteriores,
            mejoras: mejoras,
            iconoNuevo: iconoNuevo,
            tipoEvolucion: tipoEvolucion
        };
    }

    // Evolucionar todos los personajes al máximo usando las copias disponibles
    this.evolucionarTodosAlMaximo = function(usuario) {
        const rangos = data.RangosBase || [];
        const limites = data.LimiteEvolucionPorRareza || {};
        const copiasSubirNivel = data.CopiasParaSubirNivel || 1;
        const copiasCambiarRango = data.CopiasParaCambiarRango || 2;
        
        let personajesMejorados = [];
        let evolucionesTotales = 0;
        
        // Iterar por cada personaje en el inventario
        for (let instancia of usuario.inventario) {
            let animal = data.Animales.find(a => a.id == instancia.idAnimal);
            if (!animal) continue;
            
            // Compatibilidad: inicializar campos si no existen
            if (!instancia.rangoBase) {
                instancia.rangoBase = instancia.rango || "Estrellas";
            }
            if (!instancia.nivelRango) {
                instancia.nivelRango = 1;
            }

            if (!instancia.stats) {
                instancia.stats = calcularStats(animal, instancia.nivel || 1, instancia.rangoBase, instancia.nivelRango);
            }
            if (instancia.poder === undefined || instancia.poder === null) {
                instancia.poder = calcularPoder(instancia.stats);
            }

            if (instancia.rangoBase === "ETERNO" && instancia.nivelRango >= 6) {
                continue;
            }
            
            const limiteRango = limites[animal.rareza] !== undefined ? limites[animal.rareza] : 7;
            let evolucionesPersonaje = 0;
            let rangoInicial = `${rangos[rangos.findIndex(r => r.nombre === instancia.rangoBase)]?.icono || '⭐'} ${instancia.rangoBase} ${instancia.nivelRango}`;
            let poderInicial = instancia.poder;
            const esZenith = (animal.nombre === "ZENITH");
            
            // Continuar evolucionando mientras haya copias suficientes y no esté al máximo
            let puedeEvolucionar = true;
            while (puedeEvolucionar) {
                let indiceRangoActual = rangos.findIndex(r => r.nombre === instancia.rangoBase);
                if (indiceRangoActual < 0) indiceRangoActual = 0;
                
                // Verificar si está en el máximo absoluto
                if (indiceRangoActual >= limiteRango && instancia.nivelRango >= 6) {
                    puedeEvolucionar = false;
                    break;
                }
                
                // Determinar tipo de evolución y copias necesarias
                let copiasRequeridas = 0;
                let nuevoRangoBase = instancia.rangoBase;
                let nuevoNivelRango = instancia.nivelRango;
                
                if (instancia.nivelRango < 6) {
                    copiasRequeridas = copiasSubirNivel;
                    nuevoNivelRango = instancia.nivelRango + 1;
                } else if (indiceRangoActual < limiteRango) {
                    copiasRequeridas = copiasCambiarRango;
                    nuevoRangoBase = rangos[indiceRangoActual + 1].nombre;
                    nuevoNivelRango = 1;
                } else {
                    puedeEvolucionar = false;
                    break;
                }

                const esSaltoAEterno = esZenith && instancia.rangoBase === "Infinito" && instancia.nivelRango >= 6 && nuevoRangoBase === "ETERNO";
                if (esSaltoAEterno) {
                    copiasRequeridas = 1;
                }
                
                // Verificar si tiene suficientes copias
                if (instancia.copias < copiasRequeridas) {
                    puedeEvolucionar = false;
                    break;
                }
                
                // Realizar evolución
                instancia.copias -= copiasRequeridas;
                instancia.rangoBase = nuevoRangoBase;
                instancia.nivelRango = nuevoNivelRango;
                instancia.rango = nuevoRangoBase; // Compatibilidad
                
                // Recalcular stats
                instancia.stats = calcularStats(animal, instancia.nivel, instancia.rangoBase, instancia.nivelRango);
                instancia.poder = calcularPoder(instancia.stats);
                
                evolucionesPersonaje++;
                evolucionesTotales++;
            }
            
            // Si el personaje evolucionó al menos una vez, añadirlo al resumen
            if (evolucionesPersonaje > 0) {
                let indiceRangoFinal = rangos.findIndex(r => r.nombre === instancia.rangoBase);
                let rangoFinal = `${rangos[indiceRangoFinal]?.icono || '⭐'} ${instancia.rangoBase} ${instancia.nivelRango}`;
                
                personajesMejorados.push({
                    nombre: animal.nombre,
                    img: animal.img,
                    rareza: animal.rareza,
                    rangoInicial: rangoInicial,
                    rangoFinal: rangoFinal,
                    evoluciones: evolucionesPersonaje,
                    poderAnterior: poderInicial,
                    poderNuevo: instancia.poder,
                    mejoraPoder: instancia.poder - poderInicial
                });
            }
        }
        
        // Guardar en BBDD si hubo cambios
        if (evolucionesTotales > 0 && this.cad.actualizarInventario) {
            this.cad.actualizarInventario(usuario, function(res){ 
                console.log("Evoluciones masivas guardadas"); 
            });
        }
        
        return {
            exito: evolucionesTotales > 0,
            mensaje: evolucionesTotales > 0 
                ? `¡${evolucionesTotales} evoluciones realizadas en ${personajesMejorados.length} personajes!`
                : "No hay personajes que puedan evolucionar con las copias actuales",
            evolucionesTotales: evolucionesTotales,
            personajesMejorados: personajesMejorados
        };
    }

    // Subir de nivel un personaje
    this.subirNivel = function(usuario, uid, experiencia) {
        let instancia = usuario.inventario.find(inst => inst.uid === uid);
        if (!instancia) {
            return { exito: false, mensaje: "Personaje no encontrado" };
        }

        const nivelMaximo = 100;
        if (instancia.nivel >= nivelMaximo) {
            return { exito: false, mensaje: "Nivel máximo alcanzado" };
        }

        instancia.nivel = Math.min(instancia.nivel + 1, nivelMaximo);
        
        // Recalcular stats
        let animal = data.Animales.find(a => a.id == instancia.idAnimal);
        instancia.stats = calcularStats(animal, instancia.nivel, instancia.rango);

        // Guardar en BBDD
        if (this.cad.actualizarInventario) {
            this.cad.actualizarInventario(usuario, function(res){ 
                console.log("Nivel guardado"); 
            });
        }

        return { 
            exito: true, 
            mensaje: `¡Nivel ${instancia.nivel} alcanzado!`,
            instancia: instancia
        };
    }

    this.cifrarContraseña=function(password,callback){
        bcrypt.genSalt(10,function(err,salt){
            bcrypt.hash(password,salt,function(err,hash){
                callback(hash);
            });
        });
    }

    this.compararContraseña=function(password,hash,callback){
        bcrypt.compare(password,hash,function(err,res){
            if (res){
                callback(true);
            } else {
                callback(false);
            }
        });
    }

    // ==================== SISTEMA DE XP Y NIVELACIÓN ====================
    // Aplica XP a los personajes de un equipo tras una batalla
    // equipoUIDs: array de UIDs de los personajes que participaron
    // xpPorPersonaje: cantidad de XP a otorgar a cada uno
    // Retorna: array con info de level ups [{uid, nombre, subioNivel, nivelesSubidos, nivelAnterior, nivelActual}]
    this.aplicarXPEquipo = function(usuario, equipoUIDs, xpPorPersonaje) {
        if (!usuario || !equipoUIDs || xpPorPersonaje <= 0) return [];
        
        let resultados = [];
        
        for (let uid of equipoUIDs) {
            let instancia = usuario.inventario.find(inst => inst.uid === uid);
            if (instancia) {
                // Compatibilidad: asegurar que tenga xpActual
                if (instancia.xpActual === undefined) instancia.xpActual = 0;
                
                let resultado = checkLevelUp(instancia, xpPorPersonaje);
                
                // Obtener nombre del personaje para mostrar en frontend
                let animal = data.Animales.find(a => a.id === instancia.idAnimal);
                
                resultados.push({
                    uid: uid,
                    nombre: animal ? animal.nombre : 'Desconocido',
                    xpGanada: xpPorPersonaje,
                    subioNivel: resultado.subioNivel,
                    nivelesSubidos: resultado.nivelesSubidos,
                    nivelAnterior: resultado.nivelAnterior,
                    nivelActual: resultado.nivelActual,
                    xpActual: resultado.xpActual,
                    xpNecesaria: resultado.xpNecesaria,
                    stats: instancia.stats,
                    poder: instancia.poder
                });
            }
        }
        
        return resultados;
    };

}

// ==================== CLASE USUARIO ====================
// El inventario ahora almacena INSTANCIAS de personajes, no IDs simples
// Estructura de Instancia: { uid, idAnimal, nivel, xpActual, rangoBase, nivelRango, copias, stats, poder }
function Usuario(nick, inventario, monedas, equipamiento) {
    this.nick = nick;
    this.email = nick; // Aseguramos que email esté disponible para el CAD
    this._id = null;
    // Inventario de instancias de personajes
    this.inventario = inventario || [];
    this.monedas = (monedas !== undefined) ? monedas : 1000;
    // Equipamiento forjado del usuario
    this.equipamiento = equipamiento || [];
}

// Genera un UID único para cada instancia de personaje
function generarUID() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 11);
}

// Calcula el PODER de un personaje según la fórmula
function calcularPoder(stats) {
    const formula = data.FormulaPoder || { ataque: 10, defensa: 4, vida: 3 };
    return Math.floor(
        stats.ataque * formula.ataque + 
        stats.defensa * formula.defensa + 
        stats.vida * formula.vida
    );
}

// Calcula los stats de una instancia basado en nivel, rangoBase y nivelRango
function calcularStats(animal, nivel, rangoBase, nivelRango) {
    // ETERNO: multiplicador base extremo con escalado por nivel interno
    if (rangoBase === "ETERNO") {
        const multNivel = data.MultiplicadorNivel || 0.05;
        const nivelDentroEterno = nivelRango || 1;
        // Escalado extremo por nivel de ETERNO para cumplir las subidas masivas de stats
        const baseEterno = 50 + (nivelDentroEterno - 1) * 25;
        const multiplicadorTotal = (1 + (nivel - 1) * multNivel) * baseEterno;
        return {
            ataque: Math.floor(animal.ataque * multiplicadorTotal),
            defensa: Math.floor(animal.defensa * multiplicadorTotal),
            vida: Math.floor(animal.vida * multiplicadorTotal)
        };
    }

    const rangos = data.RangosBase || [];
    const multNivel = data.MultiplicadorNivel || 0.05;
    const multNivelRango = data.MultiplicadorPorNivelRango || 0.03;
    const multRangoBase = data.MultiplicadorPorRangoBase || 0.20;
    
    // Encontrar índice del rango base
    const indiceRango = rangos.findIndex(r => r.nombre === rangoBase);
    const rangoIdx = indiceRango >= 0 ? indiceRango : 0;
    const nivelR = nivelRango || 1;
    
    // Multiplicador total:
    // - Nivel del personaje: +5% por nivel
    // - Rango base: +20% por cada rango (Estrellas=0, Lunas=1, etc.)
    // - Nivel dentro del rango: +3% por cada nivel (1-6)
    const multiplicadorTotal = 
        (1 + (nivel - 1) * multNivel) * 
        (1 + rangoIdx * multRangoBase) * 
        (1 + (nivelR - 1) * multNivelRango);
    
    return {
        ataque: Math.floor(animal.ataque * multiplicadorTotal),
        defensa: Math.floor(animal.defensa * multiplicadorTotal),
        vida: Math.floor(animal.vida * multiplicadorTotal)
    };
}

// Crea una nueva instancia de personaje para el inventario
function crearInstanciaPersonaje(animal) {
    const nivel = 1;
    const rangoBase = "Estrellas";
    const nivelRango = 1;
    const stats = calcularStats(animal, nivel, rangoBase, nivelRango);
    
    return {
        uid: generarUID(),
        idAnimal: animal.id,
        nivel: nivel,
        xpActual: 0,             // XP acumulada en el nivel actual
        rangoBase: rangoBase,    // "Estrellas", "Lunas", "Flores", etc.
        nivelRango: nivelRango,  // 1-6 dentro del rango
        copias: 0,
        stats: stats,
        poder: calcularPoder(stats),
        // === Propiedades v2.0: Copiar datos del animal base ===
        nombre: animal.nombre,
        tipo: animal.tipo,
        rareza: animal.rareza,
        img: animal.img,
        velocidad: animal.velocidad || 50,
        pasiva: animal.pasiva || null,
        ultimate: animal.ultimate || null
    };
}

// ==================== SISTEMA DE NIVELACIÓN INFINITA ====================
// Calcula la XP necesaria para subir del nivel actual al siguiente
// Fórmula: XP_NECESARIA = 100 * NIVEL_ACTUAL
function calcularXPNecesaria(nivel) {
    const xpBase = data.XPBaseNivel || 100;
    return xpBase * nivel;
}

// Aplica XP a un personaje, sube de nivel si corresponde y recalcula stats
// Retorna { subioNivel: bool, nivelesSubidos: int, nivelAnterior: int, nivelActual: int }
function checkLevelUp(instancia, xpGanada) {
    if (!instancia || xpGanada <= 0) return { subioNivel: false, nivelesSubidos: 0 };
    
    // Compatibilidad: si no tiene xpActual, inicializarlo
    if (instancia.xpActual === undefined) instancia.xpActual = 0;
    if (instancia.nivel === undefined) instancia.nivel = 1;
    
    const nivelAnterior = instancia.nivel;
    instancia.xpActual += xpGanada;
    let nivelesSubidos = 0;
    
    // Verificar si puede subir de nivel (puede subir varios de golpe)
    let xpNecesaria = calcularXPNecesaria(instancia.nivel);
    while (instancia.xpActual >= xpNecesaria) {
        instancia.xpActual -= xpNecesaria;
        instancia.nivel++;
        nivelesSubidos++;
        xpNecesaria = calcularXPNecesaria(instancia.nivel);
    }
    
    // Si subió de nivel, recalcular stats
    if (nivelesSubidos > 0) {
        const animal = data.Animales.find(a => a.id === instancia.idAnimal);
        if (animal) {
            instancia.stats = calcularStats(animal, instancia.nivel, instancia.rangoBase || "Estrellas", instancia.nivelRango || 1);
            instancia.poder = calcularPoder(instancia.stats);
        }
    }
    
    return {
        subioNivel: nivelesSubidos > 0,
        nivelesSubidos: nivelesSubidos,
        nivelAnterior: nivelAnterior,
        nivelActual: instancia.nivel,
        xpActual: instancia.xpActual,
        xpNecesaria: calcularXPNecesaria(instancia.nivel)
    };
}

// ==================== CLASE PARTIDA (3v3) ====================
function Partida(codigo) {
    this.codigo = codigo;
    this.jugadores = []; // Cada jugador: { nick, email, equipo: [3 luchadores] }
    this.maxJug = 2;
    this.turno = null;
    this.turnoInicio = null; // timestamp ms cuando comenzó el turno actual
    this.estado = "esperando"; // "esperando" | "en_curso" | "finalizada"
    this.ganador = null;
}

module.exports.Sistema = Sistema;