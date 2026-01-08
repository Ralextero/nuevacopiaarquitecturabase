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
                this.usuarios[id] = new Usuario(nick.email, nick.inventario, nick.monedas);
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
        let animal = data.Animales.find(a => a.id === instancia.idAnimal);
        if (!animal) return null;
        
        return {
            uid: instancia.uid,
            idAnimal: animal.id,
            nombre: animal.nombre,
            tipo: animal.tipo,
            img: animal.img,
            rareza: animal.rareza,
            nivel: instancia.nivel,
            rango: instancia.rango,
            // Stats de combate (calculados según nivel y rango)
            ataque: instancia.stats.ataque,
            defensa: instancia.stats.defensa,
            vida: instancia.stats.vida,
            vidaActual: instancia.stats.vida,
            // Nuevas propiedades v2.0
            velocidad: animal.velocidad || 50,
            pasiva: animal.pasiva || null,
            ultimate: animal.ultimate || null,
            mana: 0, // Sistema de maná (max 4)
            manaMax: 4,
            // Estado de combate
            estado: "activo", // "activo" | "derrotado"
            estaDefendiendo: false
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
            // ========== EFECTOS DE DAÑO ==========
            case "dmg_x2": {
                // Daño = Ataque * 2
                if (!objetivo || objetivo.estado === "derrotado") {
                    return { error: true, mensaje: "Objetivo inválido" };
                }
                let danio = Math.floor(atacante.ataque * 2);
                this.aplicarDanio(objetivo, danio);
                resultado.efectos.push({
                    tipo: "danio",
                    objetivo: objetivo.nombre,
                    indice: indiceObjetivo,
                    danio: danio,
                    vidaRestante: objetivo.vidaActual,
                    derrotado: objetivo.estado === "derrotado"
                });
                break;
            }
            
            case "dmg_piercing": {
                // Daño = Ataque * 1.5 (ignora defensa)
                if (!objetivo || objetivo.estado === "derrotado") {
                    return { error: true, mensaje: "Objetivo inválido" };
                }
                let danio = Math.floor(atacante.ataque * 1.5);
                this.aplicarDanioDirecto(objetivo, danio);
                resultado.efectos.push({
                    tipo: "danio_perforante",
                    objetivo: objetivo.nombre,
                    indice: indiceObjetivo,
                    danio: danio,
                    vidaRestante: objetivo.vidaActual,
                    derrotado: objetivo.estado === "derrotado"
                });
                break;
            }
            
            case "dmg_x3_burn": {
                // Daño = Ataque * 3 + Estado 'Quemado'
                if (!objetivo || objetivo.estado === "derrotado") {
                    return { error: true, mensaje: "Objetivo inválido" };
                }
                let danio = Math.floor(atacante.ataque * 3);
                this.aplicarDanio(objetivo, danio);
                objetivo.estados = objetivo.estados || [];
                objetivo.estados.push({ tipo: "quemado", duracion: 3 });
                resultado.efectos.push({
                    tipo: "danio_quemadura",
                    objetivo: objetivo.nombre,
                    indice: indiceObjetivo,
                    danio: danio,
                    estadoAplicado: "quemado",
                    vidaRestante: objetivo.vidaActual,
                    derrotado: objetivo.estado === "derrotado"
                });
                break;
            }
            
            case "nuke_refund": {
                // Daño = Ataque * 4. Si mata, +2 maná
                if (!objetivo || objetivo.estado === "derrotado") {
                    return { error: true, mensaje: "Objetivo inválido" };
                }
                let danio = Math.floor(atacante.ataque * 4);
                let vidaAntes = objetivo.vidaActual;
                this.aplicarDanio(objetivo, danio);
                let mato = objetivo.estado === "derrotado";
                if (mato) {
                    atacante.mana = Math.min(atacante.mana + 2, atacante.manaMax);
                }
                resultado.efectos.push({
                    tipo: "nuke",
                    objetivo: objetivo.nombre,
                    indice: indiceObjetivo,
                    danio: danio,
                    vidaRestante: objetivo.vidaActual,
                    derrotado: mato,
                    manaRecuperado: mato ? 2 : 0
                });
                break;
            }
            
            case "crit_guaranteed": {
                // Daño = Ataque * 2.2 (crítico asegurado)
                if (!objetivo || objetivo.estado === "derrotado") {
                    return { error: true, mensaje: "Objetivo inválido" };
                }
                let danio = Math.floor(atacante.ataque * 2.2);
                this.aplicarDanio(objetivo, danio);
                resultado.efectos.push({
                    tipo: "critico",
                    objetivo: objetivo.nombre,
                    indice: indiceObjetivo,
                    danio: danio,
                    vidaRestante: objetivo.vidaActual,
                    derrotado: objetivo.estado === "derrotado"
                });
                break;
            }
            
            case "true_dmg": {
                // Daño = Ataque * 3 (ignora todo)
                if (!objetivo || objetivo.estado === "derrotado") {
                    return { error: true, mensaje: "Objetivo inválido" };
                }
                let danio = Math.floor(atacante.ataque * 3);
                this.aplicarDanioDirecto(objetivo, danio);
                resultado.efectos.push({
                    tipo: "danio_verdadero",
                    objetivo: objetivo.nombre,
                    indice: indiceObjetivo,
                    danio: danio,
                    vidaRestante: objetivo.vidaActual,
                    derrotado: objetivo.estado === "derrotado"
                });
                break;
            }
            
            case "hp_to_1": {
                // La vida del enemigo pasa a 1
                if (!objetivo || objetivo.estado === "derrotado") {
                    return { error: true, mensaje: "Objetivo inválido" };
                }
                let danio = objetivo.vidaActual - 1;
                objetivo.vidaActual = 1;
                resultado.efectos.push({
                    tipo: "juicio",
                    objetivo: objetivo.nombre,
                    indice: indiceObjetivo,
                    danio: danio,
                    vidaRestante: 1,
                    derrotado: false
                });
                break;
            }
            
            case "instant_win": {
                // ZENITH: Victoria instantánea
                partida.estado = "finalizada";
                partida.ganador = nick;
                partida.turnoInicio = null;
                resultado.ganador = nick;
                resultado.turno = null;
                resultado.efectos.push({
                    tipo: "victoria_instantanea",
                    mensaje: "ZENITH ha decretado EL FIN"
                });
                // Recompensa
                let ganadorObj = this.usuarios[atacanteJugador.email];
                if (ganadorObj) {
                    ganadorObj.monedas += 100;
                    resultado.recompensa = 100;
                }
                break;
            }
            
            // ========== EFECTOS DE ÁREA (AoE) ==========
            case "aoe_light": {
                // Daño = Ataque * 1.5 a TODOS los enemigos
                let danioBase = Math.floor(atacante.ataque * 1.5);
                equipoRival.forEach((enemigo, idx) => {
                    if (enemigo.estado !== "derrotado") {
                        this.aplicarDanio(enemigo, danioBase);
                        resultado.efectos.push({
                            tipo: "aoe_danio",
                            objetivo: enemigo.nombre,
                            indice: idx,
                            danio: danioBase,
                            vidaRestante: enemigo.vidaActual,
                            derrotado: enemigo.estado === "derrotado"
                        });
                    }
                });
                break;
            }
            
            case "aoe_heavy": {
                // Daño = Ataque * 2.5 a TODOS
                let danioBase = Math.floor(atacante.ataque * 2.5);
                equipoRival.forEach((enemigo, idx) => {
                    if (enemigo.estado !== "derrotado") {
                        this.aplicarDanio(enemigo, danioBase);
                        resultado.efectos.push({
                            tipo: "aoe_danio_pesado",
                            objetivo: enemigo.nombre,
                            indice: idx,
                            danio: danioBase,
                            vidaRestante: enemigo.vidaActual,
                            derrotado: enemigo.estado === "derrotado"
                        });
                    }
                });
                break;
            }
            
            case "aoe_freeze": {
                // Daño a todos + 50% prob. de 'Congelar'
                let danioBase = Math.floor(atacante.ataque * 1.8);
                equipoRival.forEach((enemigo, idx) => {
                    if (enemigo.estado !== "derrotado") {
                        this.aplicarDanio(enemigo, danioBase);
                        let congelado = Math.random() < 0.5;
                        if (congelado && enemigo.estado !== "derrotado") {
                            enemigo.estados = enemigo.estados || [];
                            enemigo.estados.push({ tipo: "congelado", duracion: 1 });
                        }
                        resultado.efectos.push({
                            tipo: "aoe_congelacion",
                            objetivo: enemigo.nombre,
                            indice: idx,
                            danio: danioBase,
                            congelado: congelado,
                            vidaRestante: enemigo.vidaActual,
                            derrotado: enemigo.estado === "derrotado"
                        });
                    }
                });
                break;
            }
            
            case "aoe_paralyze": {
                // Daño AoE y paraliza
                let danioBase = Math.floor(atacante.ataque * 1.6);
                equipoRival.forEach((enemigo, idx) => {
                    if (enemigo.estado !== "derrotado") {
                        this.aplicarDanio(enemigo, danioBase);
                        enemigo.estados = enemigo.estados || [];
                        enemigo.estados.push({ tipo: "paralizado", duracion: 1 });
                        resultado.efectos.push({
                            tipo: "aoe_paralisis",
                            objetivo: enemigo.nombre,
                            indice: idx,
                            danio: danioBase,
                            paralizado: true,
                            vidaRestante: enemigo.vidaActual,
                            derrotado: enemigo.estado === "derrotado"
                        });
                    }
                });
                break;
            }
            
            case "aoe_mana_drain": {
                // Daño a todos + Maná de enemigos a 0
                let danioBase = Math.floor(atacante.ataque * 1.5);
                equipoRival.forEach((enemigo, idx) => {
                    if (enemigo.estado !== "derrotado") {
                        this.aplicarDanio(enemigo, danioBase);
                        let manaRobado = enemigo.mana;
                        enemigo.mana = 0;
                        resultado.efectos.push({
                            tipo: "aoe_robo_mana",
                            objetivo: enemigo.nombre,
                            indice: idx,
                            danio: danioBase,
                            manaRobado: manaRobado,
                            vidaRestante: enemigo.vidaActual,
                            derrotado: enemigo.estado === "derrotado"
                        });
                    }
                });
                break;
            }
            
            case "aoe_cleanse": {
                // Daño AoE y quita buffs
                let danioBase = Math.floor(atacante.ataque * 2);
                equipoRival.forEach((enemigo, idx) => {
                    if (enemigo.estado !== "derrotado") {
                        this.aplicarDanio(enemigo, danioBase);
                        enemigo.buffs = [];
                        enemigo.escudo = 0;
                        resultado.efectos.push({
                            tipo: "aoe_limpieza",
                            objetivo: enemigo.nombre,
                            indice: idx,
                            danio: danioBase,
                            buffsEliminados: true,
                            vidaRestante: enemigo.vidaActual,
                            derrotado: enemigo.estado === "derrotado"
                        });
                    }
                });
                break;
            }
            
            case "aoe_blind": {
                // Daña y ciega AoE
                let danioBase = Math.floor(atacante.ataque * 1.8);
                equipoRival.forEach((enemigo, idx) => {
                    if (enemigo.estado !== "derrotado") {
                        this.aplicarDanio(enemigo, danioBase);
                        enemigo.estados = enemigo.estados || [];
                        enemigo.estados.push({ tipo: "cegado", duracion: 2 });
                        resultado.efectos.push({
                            tipo: "aoe_ceguera",
                            objetivo: enemigo.nombre,
                            indice: idx,
                            danio: danioBase,
                            cegado: true,
                            vidaRestante: enemigo.vidaActual,
                            derrotado: enemigo.estado === "derrotado"
                        });
                    }
                });
                break;
            }
            
            // ========== EFECTOS DE SOPORTE ==========
            case "shield_self": {
                // Escudo = 50% de Vida Máxima
                let escudo = Math.floor(atacante.vida * 0.5);
                atacante.escudo = (atacante.escudo || 0) + escudo;
                resultado.efectos.push({
                    tipo: "escudo",
                    objetivo: atacante.nombre,
                    indice: indiceAtacante,
                    escudo: escudo,
                    escudoTotal: atacante.escudo
                });
                break;
            }
            
            case "buff_atk_team": {
                // +20% Ataque a todo el equipo
                equipoAliado.forEach((aliado, idx) => {
                    if (aliado.estado !== "derrotado") {
                        let bonus = Math.floor(aliado.ataque * 0.2);
                        aliado.ataque += bonus;
                        aliado.buffs = aliado.buffs || [];
                        aliado.buffs.push({ tipo: "ataque", valor: bonus, duracion: 3 });
                        resultado.efectos.push({
                            tipo: "buff_ataque",
                            objetivo: aliado.nombre,
                            indice: idx,
                            bonusAtaque: bonus
                        });
                    }
                });
                break;
            }
            
            case "full_heal_ally": {
                // Cura 100% de vida a un aliado
                let aliadoObjetivo = equipoAliado[indiceObjetivo] || atacante;
                if (aliadoObjetivo.estado !== "derrotado") {
                    let curacion = aliadoObjetivo.vida - aliadoObjetivo.vidaActual;
                    aliadoObjetivo.vidaActual = aliadoObjetivo.vida;
                    resultado.efectos.push({
                        tipo: "curacion_total",
                        objetivo: aliadoObjetivo.nombre,
                        indice: indiceObjetivo,
                        curacion: curacion,
                        vidaActual: aliadoObjetivo.vidaActual
                    });
                }
                break;
            }
            
            case "dmg_heal_team": {
                // Daño normal + Cura equipo 30% del ataque
                if (objetivo && objetivo.estado !== "derrotado") {
                    let danio = Math.floor(atacante.ataque * 1.5);
                    this.aplicarDanio(objetivo, danio);
                    resultado.efectos.push({
                        tipo: "danio",
                        objetivo: objetivo.nombre,
                        indice: indiceObjetivo,
                        danio: danio,
                        vidaRestante: objetivo.vidaActual,
                        derrotado: objetivo.estado === "derrotado"
                    });
                }
                // Curar equipo
                let curacionBase = Math.floor(atacante.ataque * 0.3);
                equipoAliado.forEach((aliado, idx) => {
                    if (aliado.estado !== "derrotado") {
                        let curacionReal = Math.min(curacionBase, aliado.vida - aliado.vidaActual);
                        aliado.vidaActual += curacionReal;
                        if (curacionReal > 0) {
                            resultado.efectos.push({
                                tipo: "curacion",
                                objetivo: aliado.nombre,
                                indice: idx,
                                curacion: curacionReal,
                                vidaActual: aliado.vidaActual
                            });
                        }
                    }
                });
                break;
            }
            
            case "dmg_heal_team_equal": {
                // Daña y cura equipo igual
                if (objetivo && objetivo.estado !== "derrotado") {
                    let danio = Math.floor(atacante.ataque * 2);
                    this.aplicarDanio(objetivo, danio);
                    resultado.efectos.push({
                        tipo: "danio",
                        objetivo: objetivo.nombre,
                        indice: indiceObjetivo,
                        danio: danio,
                        vidaRestante: objetivo.vidaActual,
                        derrotado: objetivo.estado === "derrotado"
                    });
                    // Curar equipo el mismo daño dividido
                    let curacionBase = Math.floor(danio / 3);
                    equipoAliado.forEach((aliado, idx) => {
                        if (aliado.estado !== "derrotado") {
                            let curacionReal = Math.min(curacionBase, aliado.vida - aliado.vidaActual);
                            aliado.vidaActual += curacionReal;
                            if (curacionReal > 0) {
                                resultado.efectos.push({
                                    tipo: "curacion",
                                    objetivo: aliado.nombre,
                                    indice: idx,
                                    curacion: curacionReal,
                                    vidaActual: aliado.vidaActual
                                });
                            }
                        }
                    });
                }
                break;
            }
            
            case "team_invuln": {
                // Todo el equipo gana 'Invulnerable' 1 turno
                equipoAliado.forEach((aliado, idx) => {
                    if (aliado.estado !== "derrotado") {
                        aliado.estados = aliado.estados || [];
                        aliado.estados.push({ tipo: "invulnerable", duracion: 1 });
                        resultado.efectos.push({
                            tipo: "invulnerabilidad",
                            objetivo: aliado.nombre,
                            indice: idx
                        });
                    }
                });
                break;
            }
            
            // ========== EFECTOS ESPECIALES ==========
            case "dmg_blind": {
                // Daño y reduce precisión
                if (!objetivo || objetivo.estado === "derrotado") {
                    return { error: true, mensaje: "Objetivo inválido" };
                }
                let danio = Math.floor(atacante.ataque * 1.5);
                this.aplicarDanio(objetivo, danio);
                objetivo.estados = objetivo.estados || [];
                objetivo.estados.push({ tipo: "cegado", duracion: 2 });
                resultado.efectos.push({
                    tipo: "danio_ceguera",
                    objetivo: objetivo.nombre,
                    indice: indiceObjetivo,
                    danio: danio,
                    cegado: true,
                    vidaRestante: objetivo.vidaActual,
                    derrotado: objetivo.estado === "derrotado"
                });
                break;
            }
            
            case "dmg_stun": {
                // Daño y aturde 1 turno
                if (!objetivo || objetivo.estado === "derrotado") {
                    return { error: true, mensaje: "Objetivo inválido" };
                }
                let danio = Math.floor(atacante.ataque * 1.5);
                this.aplicarDanio(objetivo, danio);
                objetivo.estados = objetivo.estados || [];
                objetivo.estados.push({ tipo: "aturdido", duracion: 1 });
                resultado.efectos.push({
                    tipo: "danio_aturdimiento",
                    objetivo: objetivo.nombre,
                    indice: indiceObjetivo,
                    danio: danio,
                    aturdido: true,
                    vidaRestante: objetivo.vidaActual,
                    derrotado: objetivo.estado === "derrotado"
                });
                break;
            }
            
            case "dmg_shieldbreak": {
                // Daño alto, rompe escudos
                if (!objetivo || objetivo.estado === "derrotado") {
                    return { error: true, mensaje: "Objetivo inválido" };
                }
                objetivo.escudo = 0; // Rompe escudo primero
                let danio = Math.floor(atacante.ataque * 2.5);
                this.aplicarDanioDirecto(objetivo, danio);
                resultado.efectos.push({
                    tipo: "rompe_escudo",
                    objetivo: objetivo.nombre,
                    indice: indiceObjetivo,
                    danio: danio,
                    escudoRoto: true,
                    vidaRestante: objetivo.vidaActual,
                    derrotado: objetivo.estado === "derrotado"
                });
                break;
            }
            
            case "dmg_def_scaling": {
                // Daño basado en Defensa
                if (!objetivo || objetivo.estado === "derrotado") {
                    return { error: true, mensaje: "Objetivo inválido" };
                }
                let danio = Math.floor(atacante.defensa * 2);
                this.aplicarDanio(objetivo, danio);
                resultado.efectos.push({
                    tipo: "danio_defensa",
                    objetivo: objetivo.nombre,
                    indice: indiceObjetivo,
                    danio: danio,
                    vidaRestante: objetivo.vidaActual,
                    derrotado: objetivo.estado === "derrotado"
                });
                break;
            }
            
            case "dmg_x3_random": {
                // Daño x3 a objetivo aleatorio
                let objetivosVivos = equipoRival.filter(e => e.estado !== "derrotado");
                if (objetivosVivos.length > 0) {
                    let objetivoRandom = objetivosVivos[Math.floor(Math.random() * objetivosVivos.length)];
                    let idx = equipoRival.indexOf(objetivoRandom);
                    let danio = Math.floor(atacante.ataque * 3);
                    this.aplicarDanio(objetivoRandom, danio);
                    resultado.efectos.push({
                        tipo: "danio_aleatorio",
                        objetivo: objetivoRandom.nombre,
                        indice: idx,
                        danio: danio,
                        vidaRestante: objetivoRandom.vidaActual,
                        derrotado: objetivoRandom.estado === "derrotado"
                    });
                }
                break;
            }
            
            case "lifesteal_major": {
                // Robo de vida masivo
                if (!objetivo || objetivo.estado === "derrotado") {
                    return { error: true, mensaje: "Objetivo inválido" };
                }
                let danio = Math.floor(atacante.ataque * 2.5);
                this.aplicarDanio(objetivo, danio);
                let curacion = Math.floor(danio * 0.5);
                atacante.vidaActual = Math.min(atacante.vidaActual + curacion, atacante.vida);
                resultado.efectos.push({
                    tipo: "robo_vida",
                    objetivo: objetivo.nombre,
                    indice: indiceObjetivo,
                    danio: danio,
                    vidaRobada: curacion,
                    vidaRestanteAtacante: atacante.vidaActual,
                    vidaRestante: objetivo.vidaActual,
                    derrotado: objetivo.estado === "derrotado"
                });
                break;
            }
            
            case "dmg_poison_strong": {
                // Veneno fuerte
                if (!objetivo || objetivo.estado === "derrotado") {
                    return { error: true, mensaje: "Objetivo inválido" };
                }
                let danio = Math.floor(atacante.ataque * 1.2);
                this.aplicarDanio(objetivo, danio);
                objetivo.estados = objetivo.estados || [];
                objetivo.estados.push({ tipo: "envenenado", duracion: 4, danioPorTurno: Math.floor(atacante.ataque * 0.2) });
                resultado.efectos.push({
                    tipo: "veneno",
                    objetivo: objetivo.nombre,
                    indice: indiceObjetivo,
                    danio: danio,
                    envenenado: true,
                    vidaRestante: objetivo.vidaActual,
                    derrotado: objetivo.estado === "derrotado"
                });
                break;
            }
            
            case "dmg_execute": {
                // Ejecuta si <50% HP
                if (!objetivo || objetivo.estado === "derrotado") {
                    return { error: true, mensaje: "Objetivo inválido" };
                }
                let porcentajeVida = objetivo.vidaActual / objetivo.vida;
                let danio;
                if (porcentajeVida < 0.5) {
                    danio = objetivo.vidaActual; // Ejecución
                    this.aplicarDanioDirecto(objetivo, danio);
                    resultado.efectos.push({
                        tipo: "ejecucion",
                        objetivo: objetivo.nombre,
                        indice: indiceObjetivo,
                        danio: danio,
                        ejecutado: true,
                        vidaRestante: objetivo.vidaActual,
                        derrotado: objetivo.estado === "derrotado"
                    });
                } else {
                    danio = Math.floor(atacante.ataque * 2);
                    this.aplicarDanio(objetivo, danio);
                    resultado.efectos.push({
                        tipo: "danio",
                        objetivo: objetivo.nombre,
                        indice: indiceObjetivo,
                        danio: danio,
                        ejecutado: false,
                        vidaRestante: objetivo.vidaActual,
                        derrotado: objetivo.estado === "derrotado"
                    });
                }
                break;
            }
            
            case "anti_heal": {
                // Impide curación
                if (!objetivo || objetivo.estado === "derrotado") {
                    return { error: true, mensaje: "Objetivo inválido" };
                }
                let danio = Math.floor(atacante.ataque * 1.8);
                this.aplicarDanio(objetivo, danio);
                objetivo.estados = objetivo.estados || [];
                objetivo.estados.push({ tipo: "anti_curacion", duracion: 3 });
                resultado.efectos.push({
                    tipo: "anti_curacion",
                    objetivo: objetivo.nombre,
                    indice: indiceObjetivo,
                    danio: danio,
                    antiCuracion: true,
                    vidaRestante: objetivo.vidaActual,
                    derrotado: objetivo.estado === "derrotado"
                });
                break;
            }
            
            case "dmg_multi_2": {
                // Daña a 2 enemigos
                let objetivosVivos = equipoRival.filter(e => e.estado !== "derrotado");
                let danio = Math.floor(atacante.ataque * 1.5);
                objetivosVivos.slice(0, 2).forEach(enemigo => {
                    let idx = equipoRival.indexOf(enemigo);
                    this.aplicarDanio(enemigo, danio);
                    resultado.efectos.push({
                        tipo: "danio_doble",
                        objetivo: enemigo.nombre,
                        indice: idx,
                        danio: danio,
                        vidaRestante: enemigo.vidaActual,
                        derrotado: enemigo.estado === "derrotado"
                    });
                });
                break;
            }
            
            case "dmg_bounce": {
                // Daño y devuelve carta (reducción de maná)
                if (!objetivo || objetivo.estado === "derrotado") {
                    return { error: true, mensaje: "Objetivo inválido" };
                }
                let danio = Math.floor(atacante.ataque * 1.5);
                this.aplicarDanio(objetivo, danio);
                objetivo.mana = Math.max(0, objetivo.mana - 2);
                resultado.efectos.push({
                    tipo: "danio_rebote",
                    objetivo: objetivo.nombre,
                    indice: indiceObjetivo,
                    danio: danio,
                    manaReducido: 2,
                    vidaRestante: objetivo.vidaActual,
                    derrotado: objetivo.estado === "derrotado"
                });
                break;
            }
            
            case "sleep": {
                // Duerme rival 1 turno
                if (!objetivo || objetivo.estado === "derrotado") {
                    return { error: true, mensaje: "Objetivo inválido" };
                }
                objetivo.estados = objetivo.estados || [];
                objetivo.estados.push({ tipo: "dormido", duracion: 1 });
                resultado.efectos.push({
                    tipo: "dormir",
                    objetivo: objetivo.nombre,
                    indice: indiceObjetivo,
                    dormido: true
                });
                break;
            }
            
            case "dmg_shield": {
                // Daño y Escudo
                if (!objetivo || objetivo.estado === "derrotado") {
                    return { error: true, mensaje: "Objetivo inválido" };
                }
                let danio = Math.floor(atacante.ataque * 1.5);
                this.aplicarDanio(objetivo, danio);
                let escudo = Math.floor(atacante.vida * 0.3);
                atacante.escudo = (atacante.escudo || 0) + escudo;
                resultado.efectos.push({
                    tipo: "danio_escudo",
                    objetivo: objetivo.nombre,
                    indice: indiceObjetivo,
                    danio: danio,
                    escudoGanado: escudo,
                    vidaRestante: objetivo.vidaActual,
                    derrotado: objetivo.estado === "derrotado"
                });
                break;
            }
            
            default:
                resultado.efectos.push({
                    tipo: "desconocido",
                    mensaje: `Efecto '${codigoEfecto}' no implementado`
                });
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
            // === PROCESAR ESTADOS AL CAMBIAR TURNO (Ultimate) v2.0 ===
            let efectosEstadosDefensor = this.procesarEstadosTurno(defensorJugador.equipo, true);
            if (efectosEstadosDefensor.length > 0) {
                resultado.efectosEstados = efectosEstadosDefensor;
            }
            
            // Verificar si alguien murió por efectos de estado
            if (this.equipoDerrotado(defensorJugador.equipo)) {
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
    
    // Aplica daño considerando defensa
    this.aplicarDanio = function(objetivo, danio) {
        let danioReal = Math.max(1, Math.floor(danio - objetivo.defensa * 0.5));
        
        // Primero daña escudo
        if (objetivo.escudo && objetivo.escudo > 0) {
            if (objetivo.escudo >= danioReal) {
                objetivo.escudo -= danioReal;
                return 0;
            } else {
                danioReal -= objetivo.escudo;
                objetivo.escudo = 0;
            }
        }
        
        objetivo.vidaActual -= danioReal;
        if (objetivo.vidaActual <= 0) {
            objetivo.vidaActual = 0;
            objetivo.estado = "derrotado";
        }
        
        // +1 maná al recibir daño
        if (objetivo.mana < objetivo.manaMax && objetivo.estado !== "derrotado") {
            objetivo.mana = Math.min(objetivo.mana + 1, objetivo.manaMax);
        }
        
        return danioReal;
    }
    
    // Aplica daño directo (ignora defensa y escudo)
    this.aplicarDanioDirecto = function(objetivo, danio) {
        objetivo.vidaActual -= danio;
        if (objetivo.vidaActual <= 0) {
            objetivo.vidaActual = 0;
            objetivo.estado = "derrotado";
        }
        
        // +1 maná al recibir daño
        if (objetivo.mana < objetivo.manaMax && objetivo.estado !== "derrotado") {
            objetivo.mana = Math.min(objetivo.mana + 1, objetivo.manaMax);
        }
        
        return danio;
    }

    // ==================== SISTEMA DE ESTADOS v2.0 ====================
    // Procesa los efectos de estado al inicio de cada turno
    this.procesarEstadosTurno = function(equipo, esInicioTurnoDelJugador = true) {
        let efectosAplicados = [];
        
        equipo.forEach((personaje, idx) => {
            if (personaje.estado === "derrotado" || !personaje.estados) return;
            
            let estadosActivos = [];
            
            personaje.estados.forEach(estado => {
                let efectoAplicado = null;
                
                // Solo procesar efectos al inicio del turno del jugador afectado
                if (esInicioTurnoDelJugador) {
                    switch (estado.tipo) {
                        case "quemado":
                            // Daño = 5% de vida máxima por turno
                            let danioQuemado = Math.max(1, Math.floor(personaje.vida * 0.05));
                            personaje.vidaActual = Math.max(0, personaje.vidaActual - danioQuemado);
                            efectoAplicado = {
                                tipo: "quemado",
                                personaje: personaje.nombre,
                                indice: idx,
                                danio: danioQuemado,
                                turnosRestantes: estado.duracion - 1,
                                mensaje: `🔥 ${personaje.nombre} sufre ${danioQuemado} de daño por quemadura!`
                            };
                            break;
                            
                        case "envenenado":
                            // Daño de veneno
                            let danioVeneno = estado.danioPorTurno || Math.floor(personaje.vida * 0.03);
                            personaje.vidaActual = Math.max(0, personaje.vidaActual - danioVeneno);
                            efectoAplicado = {
                                tipo: "envenenado",
                                personaje: personaje.nombre,
                                indice: idx,
                                danio: danioVeneno,
                                turnosRestantes: estado.duracion - 1,
                                mensaje: `☠️ ${personaje.nombre} sufre ${danioVeneno} de daño por veneno!`
                            };
                            break;
                            
                        case "congelado":
                            efectoAplicado = {
                                tipo: "congelado",
                                personaje: personaje.nombre,
                                indice: idx,
                                pierdeTurno: true,
                                turnosRestantes: estado.duracion - 1,
                                mensaje: `❄️ ${personaje.nombre} está congelado y no puede actuar!`
                            };
                            break;
                            
                        case "aturdido":
                        case "paralizado":
                            efectoAplicado = {
                                tipo: estado.tipo,
                                personaje: personaje.nombre,
                                indice: idx,
                                pierdeTurno: true,
                                turnosRestantes: estado.duracion - 1,
                                mensaje: `⚡ ${personaje.nombre} está ${estado.tipo} y no puede actuar!`
                            };
                            break;
                            
                        case "dormido":
                            efectoAplicado = {
                                tipo: "dormido",
                                personaje: personaje.nombre,
                                indice: idx,
                                pierdeTurno: true,
                                turnosRestantes: estado.duracion - 1,
                                mensaje: `💤 ${personaje.nombre} está dormido!`
                            };
                            break;
                            
                        case "cegado":
                            efectoAplicado = {
                                tipo: "cegado",
                                personaje: personaje.nombre,
                                indice: idx,
                                reducePrecision: 0.35,
                                turnosRestantes: estado.duracion - 1,
                                mensaje: `👁️ ${personaje.nombre} tiene visión reducida!`
                            };
                            break;
                    }
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

    // ==================== SISTEMA DE PASIVAS v2.0 ====================
    // Verifica y aplica efectos de pasiva al atacar o defender
    this.checkPasiva = function(personaje, evento, contexto) {
        if (!personaje || !personaje.pasiva) return null;
        
        let pasiva = personaje.pasiva.toLowerCase();
        let resultado = { aplicada: false, efectos: [] };
        
        // Determinar si es verificación pre-daño o post-daño
        let esPostDanio = contexto && contexto.danio !== undefined;
        
        // === PASIVAS AL RECIBIR DAÑO ===
        if (evento === "recibir_danio") {
            // === PRE-DAÑO: Solo verificar evasión ===
            if (!esPostDanio) {
                // Evasión: X% de probabilidad de evitar daño
                if (pasiva.includes("evasión") || pasiva.includes("escurridizo") || pasiva.includes("intangible")) {
                    let probEvasion = 0.10; // Por defecto 10%
                    if (pasiva.includes("35%")) probEvasion = 0.35;
                    else if (pasiva.includes("25%")) probEvasion = 0.25;
                    else if (pasiva.includes("20%")) probEvasion = 0.20;
                    else if (pasiva.includes("15%")) probEvasion = 0.15;
                    
                    if (Math.random() < probEvasion) {
                        resultado.aplicada = true;
                        resultado.evadido = true;
                        resultado.efectos.push({
                            tipo: "evasion",
                            mensaje: `${personaje.nombre} evade el ataque!`
                        });
                    }
                }
            }
            
            // === POST-DAÑO: Efectos de reacción ===
            if (esPostDanio) {
                // Piel Ardiente: 20% prob. quemar al atacante
                if (pasiva.includes("quemar") || pasiva.includes("ardiente")) {
                    if (Math.random() < 0.20) {
                        if (contexto.atacante) {
                            contexto.atacante.estados = contexto.atacante.estados || [];
                            contexto.atacante.estados.push({ tipo: "quemado", duracion: 2 });
                            resultado.aplicada = true;
                            resultado.efectos.push({
                                tipo: "quemar_atacante",
                                mensaje: `🔥 ${personaje.nombre} quema a ${contexto.atacante.nombre} con Piel Ardiente!`
                            });
                        }
                    }
                }
                
                // Congelar al recibir golpe
                if (pasiva.includes("congelar") && pasiva.includes("recibir")) {
                    let probCongelar = 0.25;
                    if (Math.random() < probCongelar && contexto.atacante) {
                        contexto.atacante.estados = contexto.atacante.estados || [];
                        contexto.atacante.estados.push({ tipo: "congelado", duracion: 1 });
                        resultado.aplicada = true;
                        resultado.efectos.push({
                            tipo: "congelar_atacante",
                            mensaje: `❄️ ${personaje.nombre} congela a ${contexto.atacante.nombre}!`
                        });
                    }
                }
                
                // Maldición: Devuelve 30% daño
                if (pasiva.includes("maldición") || pasiva.includes("devuelve")) {
                    if (contexto.atacante && contexto.danio) {
                        let danioReflejado = Math.floor(contexto.danio * 0.3);
                        contexto.atacante.vidaActual -= danioReflejado;
                        if (contexto.atacante.vidaActual <= 0) {
                            contexto.atacante.vidaActual = 0;
                            contexto.atacante.estado = "derrotado";
                        }
                        resultado.aplicada = true;
                        resultado.efectos.push({
                            tipo: "reflejo_danio",
                            danioReflejado: danioReflejado,
                            mensaje: `💀 ${personaje.nombre} refleja ${danioReflejado} de daño!`
                        });
                    }
                }
                
                // Trampa: Explota al morir
                if (pasiva.includes("trampa") || pasiva.includes("explota")) {
                    if (personaje.vidaActual <= 0 && contexto.atacante) {
                        let explosion = Math.floor(personaje.ataque * 1.5);
                        contexto.atacante.vidaActual -= explosion;
                        if (contexto.atacante.vidaActual <= 0) {
                            contexto.atacante.vidaActual = 0;
                            contexto.atacante.estado = "derrotado";
                        }
                        resultado.aplicada = true;
                        resultado.efectos.push({
                            tipo: "explosion",
                            danio: explosion,
                            mensaje: `💥 ${personaje.nombre} explota causando ${explosion} de daño!`
                        });
                    }
                }
            }
        }
        
        // === PASIVAS AL ATACAR ===
        if (evento === "atacar") {
            // Tenazas: Ignora 10% defensa rival
            if (pasiva.includes("tenazas") || pasiva.includes("ignora") && pasiva.includes("defensa")) {
                resultado.aplicada = true;
                resultado.ignorarDefensa = 0.10;
                resultado.efectos.push({
                    tipo: "perforar_defensa",
                    porcentaje: 10,
                    mensaje: `${personaje.nombre} ignora 10% de defensa!`
                });
            }
            
            // Carga: Primer ataque +50% daño
            if (pasiva.includes("carga") && pasiva.includes("primer")) {
                if (!personaje.cargaUsada) {
                    resultado.aplicada = true;
                    resultado.bonusDanio = 0.50;
                    personaje.cargaUsada = true;
                    resultado.efectos.push({
                        tipo: "carga",
                        mensaje: `${personaje.nombre} carga con +50% de daño!`
                    });
                }
            }
            
            // Furia: +Daño al perder vida
            if (pasiva.includes("furia") && pasiva.includes("vida")) {
                let porcentajeVidaPerdida = 1 - (personaje.vidaActual / personaje.vida);
                let bonusFuria = Math.floor(porcentajeVidaPerdida * 0.5 * 100) / 100; // Hasta +50%
                if (bonusFuria > 0) {
                    resultado.aplicada = true;
                    resultado.bonusDanio = (resultado.bonusDanio || 0) + bonusFuria;
                    resultado.efectos.push({
                        tipo: "furia",
                        bonus: Math.floor(bonusFuria * 100),
                        mensaje: `${personaje.nombre} enfurece! +${Math.floor(bonusFuria * 100)}% daño!`
                    });
                }
            }
            
            // Tóxico: Ataques envenenan
            if (pasiva.includes("tóxico") || pasiva.includes("envenenan")) {
                resultado.aplicada = true;
                resultado.aplicarVeneno = true;
                resultado.efectos.push({
                    tipo: "envenenar",
                    mensaje: `${personaje.nombre} envenena al objetivo!`
                });
            }
            
            // Tres Cabezas: Ataque triple (3 golpes menores)
            if (pasiva.includes("tres cabezas") || pasiva.includes("triple")) {
                resultado.aplicada = true;
                resultado.ataquesMultiples = 3;
                resultado.multiplicadorAtaque = 0.4; // Cada golpe hace 40%
                resultado.efectos.push({
                    tipo: "ataque_triple",
                    mensaje: `${personaje.nombre} ataca 3 veces!`
                });
            }
            
            // Sangre: Crítico si rival <30% HP
            if (pasiva.includes("sangre") && pasiva.includes("crítico")) {
                if (contexto.objetivo && (contexto.objetivo.vidaActual / contexto.objetivo.vida) < 0.30) {
                    resultado.aplicada = true;
                    resultado.criticoGarantizado = true;
                    resultado.efectos.push({
                        tipo: "sangre",
                        mensaje: `${personaje.nombre} huele la sangre! Crítico garantizado!`
                    });
                }
            }
            
            // Manada: +Ataque por aliado
            if (pasiva.includes("manada") && pasiva.includes("aliado")) {
                if (contexto.equipoAliado) {
                    let aliadosVivos = contexto.equipoAliado.filter(a => a.estado !== "derrotado" && a.uid !== personaje.uid).length;
                    let bonusManada = aliadosVivos * 0.10; // +10% por aliado vivo
                    if (bonusManada > 0) {
                        resultado.aplicada = true;
                        resultado.bonusDanio = (resultado.bonusDanio || 0) + bonusManada;
                        resultado.efectos.push({
                            tipo: "manada",
                            bonus: Math.floor(bonusManada * 100),
                            mensaje: `${personaje.nombre} lucha en manada! +${Math.floor(bonusManada * 100)}% daño!`
                        });
                    }
                }
            }
        }
        
        // === PASIVAS AL MORIR ===
        if (evento === "morir") {
            // División: Revive 1 vez
            if ((pasiva.includes("revive") || pasiva.includes("división")) && !personaje.revividoUsado) {
                personaje.vidaActual = Math.floor(personaje.vida * 0.1); // Revive con 10% HP
                personaje.estado = "activo";
                personaje.revividoUsado = true;
                resultado.aplicada = true;
                resultado.revivido = true;
                resultado.efectos.push({
                    tipo: "revivir",
                    vidaRestaurada: personaje.vidaActual,
                    mensaje: `${personaje.nombre} revive con ${personaje.vidaActual} HP!`
                });
            }
        }
        
        // === PASIVAS AL DEFENDER ===
        if (evento === "defender") {
            // Raíces: Regenera vida al defender
            if (pasiva.includes("raíces") || pasiva.includes("regenera") && pasiva.includes("defender")) {
                let regeneracion = Math.floor(personaje.vida * 0.10);
                personaje.vidaActual = Math.min(personaje.vidaActual + regeneracion, personaje.vida);
                resultado.aplicada = true;
                resultado.efectos.push({
                    tipo: "regeneracion",
                    curacion: regeneracion,
                    mensaje: `${personaje.nombre} regenera ${regeneracion} HP!`
                });
            }
            
            // Piel Piedra: Inicia con escudo
            if (pasiva.includes("piel piedra") || pasiva.includes("escudo")) {
                if (!personaje.escudoInicial && personaje.escudo === undefined) {
                    personaje.escudo = Math.floor(personaje.vida * 0.2);
                    personaje.escudoInicial = true;
                }
            }
            
            // Contraataque
            if (pasiva.includes("reflejo") || pasiva.includes("contraataque")) {
                if (Math.random() < 0.20) {
                    resultado.aplicada = true;
                    resultado.contraataque = true;
                    resultado.efectos.push({
                        tipo: "contraataque",
                        mensaje: `${personaje.nombre} contraataca!`
                    });
                }
            }
        }
        
        // === PASIVAS INICIO DE TURNO ===
        if (evento === "inicio_turno") {
            // Batería: +1 Maná inicial
            if (pasiva.includes("batería") && pasiva.includes("maná")) {
                if (!personaje.bateriaAplicada) {
                    personaje.mana = Math.min(personaje.mana + 1, personaje.manaMax);
                    personaje.bateriaAplicada = true;
                    resultado.aplicada = true;
                    resultado.efectos.push({
                        tipo: "mana_extra",
                        mensaje: `${personaje.nombre} genera +1 maná!`
                    });
                }
            }
            
            // Mareas: Recupera 5% vida/turno
            if (pasiva.includes("mareas") || pasiva.includes("recupera") && pasiva.includes("vida")) {
                let regeneracion = Math.floor(personaje.vida * 0.05);
                personaje.vidaActual = Math.min(personaje.vidaActual + regeneracion, personaje.vida);
                resultado.aplicada = true;
                resultado.efectos.push({
                    tipo: "regeneracion_turno",
                    curacion: regeneracion,
                    mensaje: `${personaje.nombre} recupera ${regeneracion} HP!`
                });
            }
            
            // Aura Muerte: Enemigos pierden HP
            if (pasiva.includes("aura muerte") || pasiva.includes("enemigos pierden")) {
                resultado.aplicada = true;
                resultado.auraMuerte = true;
                resultado.efectos.push({
                    tipo: "aura_muerte",
                    mensaje: `El aura de ${personaje.nombre} daña a los enemigos!`
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
            });
        });
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
        if (!jugador) return null;
        
        let luchador = jugador.equipo[indiceLuchador];
        if (!luchador || luchador.estado === "derrotado") {
            return null;
        }
        
        luchador.estaDefendiendo = true;
        
        // Cambiar turno
        let rival = partida.jugadores.find(j => j.nick !== nick);
        partida.turno = rival.nick;
        partida.turnoInicio = Date.now();
        
        return {
            accion: "defender",
            jugador: nick,
            indiceLuchador: indiceLuchador,
            luchadorNombre: luchador.nombre,
            turno: partida.turno,
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
        
        // Calcular daño
        let esCritico = false;
        let esBloqueado = false;
        let multiplicador = 1;
        
        // Ventaja de tipo
        if (data.TablaTipos[atacante.tipo] && data.TablaTipos[atacante.tipo].includes(defensor.tipo)) {
            multiplicador = 1.5;
            esCritico = true;
        }
        
        // === PASIVAS: Bonus daño ===
        if (pasivaAtacante && pasivaAtacante.bonusDanio) {
            multiplicador += pasivaAtacante.bonusDanio;
        }
        if (pasivaAtacante && pasivaAtacante.criticoGarantizado) {
            esCritico = true;
            multiplicador *= 1.5;
        }
        
        let ataqueTotal = atacante.ataque * multiplicador;
        let defensaTotal = defensor.defensa;
        
        // === PASIVAS: Ignorar defensa ===
        if (pasivaAtacante && pasivaAtacante.ignorarDefensa) {
            defensaTotal = Math.floor(defensaTotal * (1 - pasivaAtacante.ignorarDefensa));
        }
        
        // Bonus de defensa si estaba defendiendo
        if (defensor.estaDefendiendo) {
            defensaTotal = Math.floor(defensaTotal * 1.5);
            esBloqueado = true;
            defensor.estaDefendiendo = false;
        }
        
        let danio = Math.max(1, Math.floor(ataqueTotal - defensaTotal)); // Mínimo 1 de daño
        
        // === PASIVAS: Ataques múltiples ===
        let totalDanio = danio;
        if (pasivaAtacante && pasivaAtacante.ataquesMultiples) {
            totalDanio = Math.floor(danio * pasivaAtacante.multiplicadorAtaque * pasivaAtacante.ataquesMultiples);
        }
        
        // Primero absorber escudo
        if (defensor.escudo && defensor.escudo > 0) {
            if (defensor.escudo >= totalDanio) {
                defensor.escudo -= totalDanio;
                totalDanio = 0;
            } else {
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
            defensor.estados.push({ tipo: "envenenado", duracion: 3, danioPorTurno: Math.floor(atacante.ataque * 0.1) });
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
            vidaRestante: defensor.vidaActual,
            esCritico: esCritico,
            esBloqueado: esBloqueado,
            personajeDerrotado: personajeDerrotado,
            ganador: null,
            recompensa: 0,
            turno: defensorJugador.nick,
            // v2.0: Efectos de pasivas aplicados
            pasivaAtacanteEfectos: pasivaAtacante ? pasivaAtacante.efectos : [],
            pasivaDefensorEfectos: pasivaDefensor ? pasivaDefensor.efectos : []
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
            // === PROCESAR ESTADOS AL CAMBIAR TURNO v2.0 ===
            // Procesar efectos de estado del equipo que va a recibir el turno
            let efectosEstadosDefensor = this.procesarEstadosTurno(defensorJugador.equipo, true);
            if (efectosEstadosDefensor.length > 0) {
                resultado.efectosEstados = efectosEstadosDefensor;
            }
            
            // Verificar si alguien murió por efectos de estado
            if (this.equipoDerrotado(defensorJugador.equipo)) {
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

        usuario.monedas -= costoInvocacion;

        // Pre-Roll Divino (0.01% para ZENITH)
        let zenith = null;
        if (Math.random() < 0.0001) { // 0.01%
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

        usuario.monedas -= costoMultiple;
        let resultados = [];

        for (let i = 0; i < 10; i++) {
            // Determinar rareza según probabilidades
            let aleatorio = Math.random() * 100;
            let rareza = "";
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
            let animal = animalesPosibles[Math.floor(Math.random() * animalesPosibles.length)];

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

        usuario.monedas -= costoCien;
        let resultados = [];

        for (let i = 0; i < 100; i++) {
            // Determinar rareza según probabilidades
            let aleatorio = Math.random() * 100;
            let rareza = "";
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
            let animal = animalesPosibles[Math.floor(Math.random() * animalesPosibles.length)];

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

    this.obtenerInventario = function(usuario) {
        const rangos = data.RangosBase || [];
        const limites = data.LimiteEvolucionPorRareza || {};
        let inventarioCompleto = [];
        
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
function Usuario(nick, inventario, monedas) {
    this.nick = nick;
    this.email = nick; // Aseguramos que email esté disponible para el CAD
    this._id = null;
    // Inventario de instancias de personajes
    this.inventario = inventario || [];
    this.monedas = (monedas !== undefined) ? monedas : 1000;
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