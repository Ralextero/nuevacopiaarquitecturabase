// ==================== CONSTANTES DE EVOLUCIÓN ====================
// Sistema de rangos con 6 niveles cada uno: ⭐ Estrellas → 🌙 Lunas → 🌸 Flores → ☀️ Soles → 👑 Coronas → 🐉 Dragones → ⚡ Dioses → ♾️ Infinito → 🜂 ETERNO
// Cada rango tiene 6 niveles (ej: 1⭐, 2⭐, 3⭐, 4⭐, 5⭐, 6⭐)
// Total de niveles posibles: 9 rangos × 6 niveles = 54 niveles de progresión

module.exports.RangosBase = [
    { nombre: "Estrellas", icono: "⭐", color: "#87ceeb" },
    { nombre: "Lunas", icono: "🌙", color: "#c0c0ff" },
    { nombre: "Flores", icono: "🌸", color: "#ffb6c1" },
    { nombre: "Soles", icono: "☀️", color: "#ffd700" },
    { nombre: "Coronas", icono: "👑", color: "#ff8c00" },
    { nombre: "Dragones", icono: "🐉", color: "#9932cc" },
    { nombre: "Dioses", icono: "⚡", color: "#00ffff" },
    { nombre: "Infinito", icono: "♾️", color: "#ff00ff" },
    { nombre: "ETERNO", icono: "🜂", color: "#ff002e" }
];

// Límites de evolución por rareza (índice del rango máximo en RangosBase)
module.exports.LimiteEvolucionPorRareza = {
    "Común": 2,      // Máximo: Flores (índice 2)
    "Raro": 5,       // Máximo: Dragones (índice 5)
    "SSR": 6,        // Máximo: Dioses (índice 6)
    "UR": 7,         // Máximo: Infinito (índice 7)
    "ABSOLUTE": 8    // Máximo: ETERNO (índice 8)
};

// Copias requeridas para subir de nivel dentro del mismo rango
module.exports.CopiasParaSubirNivel = 1; // 1 copia = +1 nivel en el rango

// Copias requeridas para subir al siguiente rango (de 6 estrellas a 1 luna, etc.)
module.exports.CopiasParaCambiarRango = 2;

// Multiplicadores de stats
// ═══════════════════════════════════════════════════════════════
// FÓRMULA DE DAÑO: danioFinal = max(0, danioBase - (defensa × 0.5))
// FÓRMULA DE PODER: PODER = 10×ATK + 4×DEF + 3×VID
// ═══════════════════════════════════════════════════════════════
// Cada nivel dentro del rango da +3% y cada rango base da +20%
module.exports.MultiplicadorPorNivelRango = 0.03;  // +3% por cada nivel (1-6)
module.exports.MultiplicadorPorRangoBase = 0.20;   // +20% por cada rango base

// Fórmula de PODER: 10*ATK + 4*DEF + 3*VID
module.exports.FormulaPoder = {
    ataque: 10,
    defensa: 4,
    vida: 3
};

// Multiplicador de stats por nivel (cada nivel aumenta stats un 5%)
module.exports.MultiplicadorNivel = 0.05;

// ==================== SISTEMA DE XP Y NIVELACIÓN ====================
// XP necesaria para subir al siguiente nivel: XP_NECESARIA = 100 * NIVEL_ACTUAL
module.exports.XPBaseNivel = 100; // Multiplicador base para calcular XP necesaria

// XP otorgada al final de cada batalla
module.exports.XPBatalla = {
    ganador: 50,   // XP por personaje al ganar
    perdedor: 15   // XP por personaje al perder (incentivo)
};

// ==================== BASE DE DATOS DE PERSONAJES v3.0 ====================
// 35 Personajes con habilidades: velocidad, pasiva, ultimate
module.exports.Personajes = [
    // === 🔥 FUEGO (Velocidad Media: 50-70) ===
    { id: 1, nombre: "Salamandra", tipo: "Fuego", ataque: 45, defensa: 35, vida: 90, velocidad: 60, evasion: 0, rareza: "Común", img: "/cliente/img/salamandra.png", pasiva: "Piel Ardiente: 20% prob. quemar atacante (5% vida máx/turno, 3 turnos).", ultimate: { nombre: "Llamarada", coste: 4, efecto: "crit_200", desc: "Crítico garantizado, 200% daño." } },
    { id: 2, nombre: "Escorpión de Magma", tipo: "Fuego", ataque: 52, defensa: 38, vida: 95, velocidad: 55, evasion: 0, rareza: "Común", img: "/cliente/img/escorpion.png", pasiva: "Tenazas: Ignora 10% defensa rival permanente.", ultimate: { nombre: "Aguijón", coste: 4, efecto: "dmg_piercing_full", desc: "150% daño, ignora escudos y buffs def." } },
    { id: 3, nombre: "Centauro Volcánico", tipo: "Fuego", ataque: 72, defensa: 58, vida: 140, velocidad: 65, evasion: 0, rareza: "Raro", img: "/cliente/img/centauro.png", pasiva: "Carga: Primer ataque +50% daño.", ultimate: { nombre: "Estampida", coste: 4, efecto: "aoe_60", desc: "60% daño a todos los enemigos." } },
    { id: 4, nombre: "Ifrit", tipo: "Fuego", ataque: 95, defensa: 70, vida: 175, velocidad: 70, evasion: 0, rareza: "SSR", img: "/cliente/img/ifrit.png", pasiva: "Espíritu Ígneo: Inmune a Quemadura.", ultimate: { nombre: "Infierno", coste: 4, efecto: "dmg_300_burn_grave", desc: "300% daño + quemadura grave (10% vida/turno)." } },
    { id: 5, nombre: "Dragón Rojo", tipo: "Fuego", ataque: 105, defensa: 78, vida: 190, velocidad: 68, evasion: 0, rareza: "SSR", img: "/cliente/img/dragon.png", pasiva: "Furia: +1% daño por cada 1% vida que te falta.", ultimate: { nombre: "Aliento", coste: 4, efecto: "aoe_120", desc: "120% daño a todos los enemigos." } },
    { id: 6, nombre: "Surtur", tipo: "Fuego", ataque: 130, defensa: 95, vida: 280, velocidad: 50, evasion: 0, rareza: "UR", img: "/cliente/img/surtur.png", pasiva: "Cataclismo: -20% Defensa a todos los enemigos.", ultimate: { nombre: "Ragnarok", coste: 4, efecto: "nuke_350_refund", desc: "350% daño. Si mata, +2 maná." } },
// === 💧 AGUA (Velocidad: 50-65) ===
{ id: 7, nombre: "Hipocampo", tipo: "Agua", ataque: 42, defensa: 40, vida: 95, velocidad: 60, evasion: 10, rareza: "Común", img: "/cliente/img/hipocampo.png", pasiva: "Escurridizo: 10% evasión base.", ultimate: { nombre: "Chorro", coste: 4, efecto: "dmg_120_blind", desc: "120% daño + ceguera (-30% precisión, 2 turnos)." } },
{ id: 8, nombre: "Medusa", tipo: "Agua", ataque: 50, defensa: 42, vida: 88, velocidad: 58, evasion: 0, rareza: "Común", img: "/cliente/img/medusa.png", pasiva: "Tóxico: 30% prob. envenenar al atacar (5% vida/turno, 3 turnos).", ultimate: { nombre: "Mirada Pétrea", coste: 4, efecto: "dmg_100_stun", desc: "100% daño + aturde 1 turno." } },
{ id: 9, nombre: "Tiburón Acorazado", tipo: "Agua", ataque: 75, defensa: 65, vida: 145, velocidad: 62, evasion: 0, rareza: "Raro", img: "/cliente/img/tiburon.png", pasiva: "Rastro de Sangre: Crítico automático si rival <30% HP.", ultimate: { nombre: "Mandíbula", coste: 4, efecto: "shieldbreak_150", desc: "Destruye escudo + 150% daño." } },
{ id: 10, nombre: "Gigante de Escarcha", tipo: "Agua", ataque: 92, defensa: 85, vida: 200, velocidad: 45, evasion: 0, rareza: "SSR", img: "/cliente/img/giganteEscarcha.png", pasiva: "Cero Absoluto: 25% congelar al atacante al recibir golpe.", ultimate: { nombre: "Avalancha", coste: 4, efecto: "aoe_80_freeze40", desc: "80% daño a todos + 40% congelar cada uno." } },
{ id: 11, nombre: "Poseidón", tipo: "Agua", ataque: 100, defensa: 80, vida: 185, velocidad: 65, evasion: 0, rareza: "SSR", img: "/cliente/img/poseidon.png", pasiva: "Mareas Vivas: Recupera 5% vida al inicio de tu turno.", ultimate: { nombre: "Tridente", coste: 4, efecto: "dmg_120_heal_team_20", desc: "120% daño + cura 20% vida a aliados." } },
{ id: 12, nombre: "Leviatán", tipo: "Agua", ataque: 125, defensa: 100, vida: 300, velocidad: 50, evasion: 0, rareza: "UR", img: "/cliente/img/leviathan.png", pasiva: "Piel Abisal: -30% daño recibido permanente.", ultimate: { nombre: "Tsunami", coste: 4, efecto: "aoe_100_purge", desc: "100% daño a todos + purga buffs enemigos." } },
// === 🪨 TIERRA (Velocidad Lenta: 20-40) ===
{ id: 13, nombre: "Ent Guardián", tipo: "Tierra", ataque: 38, defensa: 50, vida: 110, velocidad: 30, evasion: 0, rareza: "Común", img: "/cliente/img/ent.png", pasiva: "Raíces: Al defender, cura 10% vida máxima.", ultimate: { nombre: "Corteza", coste: 4, efecto: "shield_50", desc: "Escudo del 50% de tu vida máxima." } },
{ id: 14, nombre: "Lobo Gris", tipo: "Tierra", ataque: 48, defensa: 42, vida: 100, velocidad: 40, evasion: 0, rareza: "Común", img: "/cliente/img/lobo.png", pasiva: "Manada: +15% ataque por aliado vivo (máx +30%).", ultimate: { nombre: "Aullido", coste: 4, efecto: "buff_atk_team_20", desc: "+20% Ataque equipo por 3 turnos." } },
{ id: 15, nombre: "Minotauro", tipo: "Tierra", ataque: 78, defensa: 60, vida: 150, velocidad: 35, evasion: 0, rareza: "Raro", img: "/cliente/img/minotauro.png", pasiva: "Reflejo: 20% prob. contraataque (100% daño).", ultimate: { nombre: "Seísmo", coste: 4, efecto: "dmg_130_armor_break", desc: "130% daño + -50% defensa 2 turnos." } },
{ id: 16, nombre: "Gólem Ancestral", tipo: "Tierra", ataque: 88, defensa: 95, vida: 210, velocidad: 25, evasion: 0, rareza: "SSR", img: "/cliente/img/golem.png", pasiva: "Inamovible: Inmune a Stun y Congelación.", ultimate: { nombre: "Aplastar", coste: 4, efecto: "dmg_def_250", desc: "Daño = 250% de tu DEFENSA." } },
{ id: 17, nombre: "Gárgola", tipo: "Tierra", ataque: 95, defensa: 88, vida: 195, velocidad: 28, evasion: 0, rareza: "SSR", img: "/cliente/img/gargola.png", pasiva: "Piel de Piedra: Inicia con escudo 20% vida.", ultimate: { nombre: "Derrumbe", coste: 4, efecto: "dmg_triple_random", desc: "3 ataques de 100% a objetivos aleatorios." } },
{ id: 18, nombre: "Behemoth", tipo: "Tierra", ataque: 120, defensa: 115, vida: 340, velocidad: 20, evasion: 0, rareza: "UR", img: "/cliente/img/behemoth.png", pasiva: "Titán: +50% Vida Máxima base.", ultimate: { nombre: "Devorar", coste: 4, efecto: "lifesteal_150", desc: "150% daño + robo vida 100%." } },
// === 🌪️ AIRE (Velocidad Alta: 85-100) ===
{ id: 19, nombre: "Águila Real", tipo: "Aire", ataque: 55, defensa: 32, vida: 85, velocidad: 90, evasion: 0, rareza: "Común", img: "/cliente/img/aguila.png", pasiva: "Vista Aguda: Ignora evasión enemiga (100% precisión).", ultimate: { nombre: "Picada", coste: 4, efecto: "crit_150", desc: "Crítico garantizado, 150% daño." } },
{ id: 20, nombre: "Mantaraya", tipo: "Aire", ataque: 48, defensa: 45, vida: 92, velocidad: 85, evasion: 0, rareza: "Común", img: "/cliente/img/mantarayaAire.png", pasiva: "Vuelo: Inmune a daño de tipo Tierra.", ultimate: { nombre: "Electroshock", coste: 4, efecto: "dmg_110_x2", desc: "110% daño a 2 enemigos aleatorios." } },
{ id: 21, nombre: "Grifo Real", tipo: "Aire", ataque: 76, defensa: 55, vida: 135, velocidad: 88, evasion: 0, rareza: "Raro", img: "/cliente/img/grifo.png", pasiva: "Viento de Cola: Gana empates de velocidad.", ultimate: { nombre: "Vendaval", coste: 4, efecto: "dmg_120_swap", desc: "120% daño + obliga cambio de personaje." } },
{ id: 22, nombre: "Thunderbird", tipo: "Aire", ataque: 102, defensa: 65, vida: 165, velocidad: 95, evasion: 0, rareza: "SSR", img: "/cliente/img/thunderbird.png", pasiva: "Batería: Equipo inicia con +1 Maná extra.", ultimate: { nombre: "Tormenta", coste: 4, efecto: "aoe_80_paralyze30", desc: "80% daño a todos + 30% paralizar." } },
{ id: 23, nombre: "Guardián Aéreo", tipo: "Aire", ataque: 90, defensa: 82, vida: 180, velocidad: 92, evasion: 0, rareza: "SSR", img: "/cliente/img/guardianAire.png", pasiva: "Neblina: +10% Evasión a todo el equipo.", ultimate: { nombre: "Muro de Viento", coste: 4, efecto: "team_invuln", desc: "Equipo INVULNERABLE 1 turno." } },
{ id: 24, nombre: "Zephyr", tipo: "Aire", ataque: 135, defensa: 88, vida: 270, velocidad: 100, evasion: 35, rareza: "UR", img: "/cliente/img/dragonAire.png", pasiva: "Intangible: 35% Evasión base.", ultimate: { nombre: "Huracán", coste: 4, efecto: "aoe_90_mana_drain", desc: "90% daño a todos + -1 maná por enemigo." } },
// === 🌑 OSCURIDAD (Velocidad: 40-50) ===
{ id: 25, nombre: "Araña Sombría", tipo: "Oscuridad", ataque: 55, defensa: 35, vida: 85, velocidad: 45, evasion: 0, rareza: "Común", img: "/cliente/img/arana.png", pasiva: "Telaraña: 25% prob. de paralizar al atacar (pierde 1 turno).", ultimate: { nombre: "Veneno Letal", coste: 4, efecto: "poison_strong", desc: "Veneno fuerte: 10% vida/turno, 3 turnos." } },
{ id: 26, nombre: "Cofre Mímico", tipo: "Oscuridad", ataque: 70, defensa: 62, vida: 130, velocidad: 40, evasion: 0, rareza: "Raro", img: "/cliente/img/cofre.png", pasiva: "Última Risa: Explota al morir (100% ataque al asesino).", ultimate: { nombre: "Tragar", coste: 4, efecto: "execute_50", desc: "Si <50% vida, ejecuta. Sino 50% daño." } },
{ id: 27, nombre: "Cerbero", tipo: "Oscuridad", ataque: 98, defensa: 72, vida: 175, velocidad: 50, evasion: 0, rareza: "SSR", img: "/cliente/img/cerbero.png", pasiva: "Tres Cabezas: Ataque básico = 3 golpes de 40%.", ultimate: { nombre: "Aliento de Hades", coste: 4, efecto: "dmg_130_curse", desc: "130% daño + maldición (no puede curarse 3 turnos)." } },
{ id: 28, nombre: "Caballero Oscuro", tipo: "Oscuridad", ataque: 105, defensa: 80, vida: 185, velocidad: 42, evasion: 0, rareza: "SSR", img: "/cliente/img/caballeroOscuro.png", pasiva: "Venganza: Devuelve 30% del daño recibido.", ultimate: { nombre: "Hoja del Vacío", coste: 4, efecto: "true_dmg_150", desc: "150 daño verdadero (ignora defensa y escudos)." } },
{ id: 29, nombre: "Ángel Caído", tipo: "Oscuridad", ataque: 138, defensa: 92, vida: 290, velocidad: 48, evasion: 0, rareza: "UR", img: "/cliente/img/angelCaido.png", pasiva: "Aura de Muerte: Enemigos pierden 5% vida máx al inicio de cada turno.", ultimate: { nombre: "Juicio Final", coste: 4, efecto: "reduce_to_1", desc: "Reduce vida del objetivo a 1 HP." } },
// === ✨ LUZ (Velocidad: 70-88) ===
{ id: 30, nombre: "Polilla Lunar", tipo: "Luz", ataque: 45, defensa: 38, vida: 88, velocidad: 80, evasion: 0, rareza: "Común", img: "/cliente/img/polilla.png", pasiva: "Polvo: 15% prob. cegar atacante (50% menos precisión).", ultimate: { nombre: "Sueño Eterno", coste: 4, efecto: "sleep_bonus", desc: "Duerme 1 turno. Si despierta por daño, +50% daño." } },
{ id: 31, nombre: "Slime Real", tipo: "Luz", ataque: 40, defensa: 48, vida: 105, velocidad: 70, evasion: 0, rareza: "Común", img: "/cliente/img/slime.png", pasiva: "Mitosis: Revive 1 vez con 50% vida.", ultimate: { nombre: "Rebote", coste: 4, efecto: "dmg_100_shield_equal", desc: "100% daño + escudo igual al daño infligido." } },
{ id: 32, nombre: "Unicornio", tipo: "Luz", ataque: 68, defensa: 65, vida: 145, velocidad: 78, evasion: 0, rareza: "Raro", img: "/cliente/img/unicornio.png", pasiva: "Pureza: Inmune a Veneno, Ceguera y Stun.", ultimate: { nombre: "Cuerno de Luz", coste: 4, efecto: "full_heal_cleanse", desc: "Cura 100% vida aliado + quita estados negativos." } },
{ id: 33, nombre: "León Solar", tipo: "Luz", ataque: 100, defensa: 78, vida: 180, velocidad: 82, evasion: 0, rareza: "SSR", img: "/cliente/img/leon.png", pasiva: "Rey Sol: +10% Ataque y +10% Defensa a aliados.", ultimate: { nombre: "Explosión Solar", coste: 4, efecto: "aoe_80_blind50", desc: "80% daño a todos + 50% prob. cegar." } },
{ id: 34, nombre: "Valquiria", tipo: "Luz", ataque: 128, defensa: 105, vida: 310, velocidad: 88, evasion: 0, rareza: "UR", img: "/cliente/img/valkiria.png", pasiva: "Valhalla: 25% prob. revivir aliado muerto con 50% HP al inicio de tu turno.", ultimate: { nombre: "Luz Sagrada", coste: 4, efecto: "dmg_150_heal_equal", desc: "150% daño + cura al equipo el daño infligido." } },
// === ⚡ GOD TIER ===
{ id: 999, nombre: "ZENITH", tipo: "ORIGEN", ataque: 9999, defensa: 9999, vida: 9999, velocidad: 999, evasion: 100, rareza: "ABSOLUTE", img: "/cliente/img/zenithEspecial.png", pasiva: "Omnipotencia: Inmune a todo (daño, estados, muerte).", ultimate: { nombre: "EL FIN", coste: 1, efecto: "instant_win", desc: "Victoria Instantánea." } }
];

// Alias para compatibilidad con código existente
module.exports.Animales = module.exports.Personajes;

// ==================== TABLA DE VENTAJAS DE TIPO ====================
module.exports.TablaTipos = {
    "Fuego": ["Aire"],       // Fuego consume Aire
    "Agua": ["Fuego"],                  // Agua apaga Fuego
    "Tierra": ["Agua"],          // Tierra absorbe Agua
    "Aire": ["Tierra"],         // Aire erosiona Tierra
    "Luz": ["Oscuridad"],       // Luz disipa Oscuridad
    "Oscuridad": ["Luz"],       // Oscuridad corrompe Luz
    "ORIGEN": ["Fuego", "Agua", "Tierra", "Aire", "Luz", "Oscuridad"] // ZENITH domina todo
};

// ==================== PROBABILIDADES DE GACHA ====================
// Tasas realistas tipo gacha comercial
module.exports.ProbabilidadesGacha = {
    "UR": 0.5,      // 0.5% - Extremadamente raro
    "SSR": 3.5,     // 3.5% (acumulado 4%)
    "Raro": 20,     // 20% (acumulado 24%)
    "Común": 76     // 76% (acumulado 100%)
};

// ==================== COSTOS ====================
module.exports.Costos = {
    invocacionSimple: 100,
    invocacionMultiple: 900,  // 10 invocaciones con descuento
    invocacionCien: 8000,     // 100 invocaciones con mayor descuento (20% off)
    // Equipamiento (doble que personajes)
    equipamientoSimple: 200,
    equipamientoMultiple: 1800,  // 10 invocaciones con descuento
    equipamientoCien: 16000      // 100 invocaciones con mayor descuento
};

// ==================== PROBABILIDADES EQUIPAMIENTO ====================
module.exports.ProbabilidadesEquipamiento = {
    rareza: { Común: 50, Raro: 47.5, SSR: 2.5 },
    elemento: { Fuego: 20, Agua: 20, Tierra: 20, Aire: 20, Luz: 10, Oscuridad: 10 }
};

// ==================== TIPOS DE EQUIPAMIENTO ====================
module.exports.TiposEquipamiento = ["Casco", "Pechera", "Pantalones", "Zapatos", "Arma"];
module.exports.ElementosEquipamiento = ["Fuego", "Agua", "Tierra", "Aire", "Luz", "Oscuridad"];

// ==================== LÍMITES DE INVENTARIO ====================
module.exports.LimitesInventario = {
    maxEquipamiento: 300,           // Máximo de items de equipamiento
    recompensaEliminar: 25          // Monedas por eliminar un item
};

// ==================== FONDOS DE BATALLA ====================
module.exports.FondosBatalla = [
    { tipo: "Fuego", imagen: "/cliente/fondo/fondoFuego.png", color: "#ff4500" },
    { tipo: "Agua", imagen: "/cliente/fondo/fondoAgua.png", color: "#00bfff" },
    { tipo: "Tierra", imagen: "/cliente/fondo/fondoTierra.png", color: "#8b4513" },
    { tipo: "Aire", imagen: "/cliente/fondo/fondoAire.png", color: "#87ceeb" },
    { tipo: "Luz", imagen: "/cliente/fondo/fondoLuz.png", color: "#ffd700" },
    { tipo: "Oscuridad", imagen: "/cliente/fondo/fondoOscuridad.png", color: "#4b0082" }
];

// Modificador de stats por fondo (beneficio para tipo afín, penalización para tipo débil)
module.exports.ModificadorFondo = {
    bonificacion: 1.15,    // +15% stats para tipos afines
    penalizacion: 0.85     // -15% stats para tipos débiles (countered)
};
