// ==================== CONSTANTES DE EVOLUCIÓN ====================
// Sistema de rangos con 6 niveles cada uno: ⭐ Estrellas → 🌙 Lunas → 🌸 Flores → ☀️ Soles → 👑 Coronas → 🐉 Dragones → ⚡ Dioses → ♾️ Infinito → 🜂 ETERNO
// Cada rango tiene 6 niveles (ej: 1⭐, 2⭐, 3⭐, 4⭐, 5⭐, 6⭐)

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

// ==================== BASE DE DATOS DE PERSONAJES v2.0 ====================
// 35 Personajes con habilidades: velocidad, pasiva, ultimate
module.exports.Personajes = [
    // === 🔥 FUEGO (Velocidad Media: 50-70) ===
    { id: 1, nombre: "Salamandra", tipo: "Fuego", ataque: 45, defensa: 35, vida: 90, velocidad: 60, rareza: "Común", img: "/cliente/img/salamandra.png", pasiva: "Piel Ardiente: 20% prob. quemar al recibir daño.", ultimate: { nombre: "Llamarada", coste: 4, efecto: "dmg_x2", desc: "Daño x2 al objetivo." } },
    { id: 2, nombre: "Escorpión de Magma", tipo: "Fuego", ataque: 52, defensa: 38, vida: 95, velocidad: 55, rareza: "Común", img: "/cliente/img/escorpion.png", pasiva: "Tenazas: Ignora 10% defensa rival.", ultimate: { nombre: "Aguijón", coste: 4, efecto: "dmg_piercing", desc: "Daño x1.5 perforante." } },
    { id: 3, nombre: "Centauro Volcánico", tipo: "Fuego", ataque: 72, defensa: 58, vida: 140, velocidad: 65, rareza: "Raro", img: "/cliente/img/centauro.png", pasiva: "Carga: Primer ataque +50% daño.", ultimate: { nombre: "Estampida", coste: 4, efecto: "aoe_light", desc: "Daño medio a todos." } },
    { id: 4, nombre: "Ifrit", tipo: "Fuego", ataque: 95, defensa: 70, vida: 175, velocidad: 70, rareza: "SSR", img: "/cliente/img/ifrit.png", pasiva: "Espíritu: Inmune a Quemadura.", ultimate: { nombre: "Infierno", coste: 4, efecto: "dmg_x3_burn", desc: "Daño x3 y quemadura grave." } },
    { id: 5, nombre: "Dragón Rojo", tipo: "Fuego", ataque: 105, defensa: 78, vida: 190, velocidad: 68, rareza: "SSR", img: "/cliente/img/dragon.png", pasiva: "Furia: +Daño al perder vida.", ultimate: { nombre: "Aliento", coste: 4, efecto: "aoe_heavy", desc: "Gran daño a todos." } },
    { id: 6, nombre: "Surtur", tipo: "Fuego", ataque: 130, defensa: 95, vida: 280, velocidad: 50, rareza: "UR", img: "/cliente/img/surtur.png", pasiva: "Cataclismo: -20% Defensa enemiga.", ultimate: { nombre: "Ragnarok", coste: 4, efecto: "nuke_refund", desc: "Daño masivo. Si mata, +2 maná." } },
// === 💧 AGUA (Velocidad: 50-65) ===
{ id: 7, nombre: "Hipocampo", tipo: "Agua", ataque: 42, defensa: 40, vida: 95, velocidad: 60, rareza: "Común", img: "/cliente/img/hipocampo.png", pasiva: "Escurridizo: 10% evasión.", ultimate: { nombre: "Chorro", coste: 4, efecto: "dmg_blind", desc: "Daño y reduce precisión." } },
{ id: 8, nombre: "Medusa", tipo: "Agua", ataque: 50, defensa: 42, vida: 88, velocidad: 58, rareza: "Común", img: "/cliente/img/medusa.png", pasiva: "Tóxico: Ataques envenenan.", ultimate: { nombre: "Mirada Pétrea", coste: 4, efecto: "dmg_stun", desc: "Daño y aturde 1 turno." } },
{ id: 9, nombre: "Tiburón Acorazado", tipo: "Agua", ataque: 75, defensa: 65, vida: 145, velocidad: 62, rareza: "Raro", img: "/cliente/img/tiburon.png", pasiva: "Sangre: Crítico si rival <30% HP.", ultimate: { nombre: "Mandíbula", coste: 4, efecto: "dmg_shieldbreak", desc: "Daño alto, rompe escudos." } },
{ id: 10, nombre: "Gigante de Escarcha", tipo: "Agua", ataque: 92, defensa: 85, vida: 200, velocidad: 45, rareza: "SSR", img: "/cliente/img/giganteEscarcha.png", pasiva: "Cero: 25% congelar al recibir golpe.", ultimate: { nombre: "Avalancha", coste: 4, efecto: "aoe_freeze", desc: "Daño AoE y congela." } },
{ id: 11, nombre: "Poseidón", tipo: "Agua", ataque: 100, defensa: 80, vida: 185, velocidad: 65, rareza: "SSR", img: "/cliente/img/poseidon.png", pasiva: "Mareas: Recupera 5% vida/turno.", ultimate: { nombre: "Tridente", coste: 4, efecto: "dmg_heal_team", desc: "Daña y cura al equipo." } },
{ id: 12, nombre: "Leviatán", tipo: "Agua", ataque: 125, defensa: 100, vida: 300, velocidad: 50, rareza: "UR", img: "/cliente/img/leviathan.png", pasiva: "Abisal: -30% daño recibido.", ultimate: { nombre: "Tsunami", coste: 4, efecto: "aoe_cleanse", desc: "Daño AoE y quita buffs." } },
// === 🪨 TIERRA (Velocidad Lenta: 20-40) ===
{ id: 13, nombre: "Ent Guardián", tipo: "Tierra", ataque: 38, defensa: 50, vida: 110, velocidad: 30, rareza: "Común", img: "/cliente/img/ent.png", pasiva: "Raíces: Regenera vida al defender.", ultimate: { nombre: "Corteza", coste: 4, efecto: "shield_self", desc: "Escudo del 50% HP." } },
{ id: 14, nombre: "Lobo Gris", tipo: "Tierra", ataque: 48, defensa: 42, vida: 100, velocidad: 40, rareza: "Común", img: "/cliente/img/lobo.png", pasiva: "Manada: +Ataque por aliado.", ultimate: { nombre: "Aullido", coste: 4, efecto: "buff_atk_team", desc: "+20% Ataque equipo." } },
{ id: 15, nombre: "Minotauro", tipo: "Tierra", ataque: 78, defensa: 60, vida: 150, velocidad: 35, rareza: "Raro", img: "/cliente/img/minotauro.png", pasiva: "Reflejo: 20% prob. contraataque.", ultimate: { nombre: "Seísmo", coste: 4, efecto: "dmg_break_def", desc: "Daño y rompe defensa." } },
{ id: 16, nombre: "Gólem Ancestral", tipo: "Tierra", ataque: 88, defensa: 95, vida: 210, velocidad: 25, rareza: "SSR", img: "/cliente/img/golem.png", pasiva: "Inamovible: Inmune a Stun.", ultimate: { nombre: "Aplastar", coste: 4, efecto: "dmg_def_scaling", desc: "Daño basado en Defensa." } },
{ id: 17, nombre: "Gárgola", tipo: "Tierra", ataque: 95, defensa: 88, vida: 195, velocidad: 28, rareza: "SSR", img: "/cliente/img/gargola.png", pasiva: "Piel Piedra: Inicia con escudo.", ultimate: { nombre: "Derrumbe", coste: 4, efecto: "dmg_x3_random", desc: "Daño x3 aleatorio." } },
{ id: 18, nombre: "Behemoth", tipo: "Tierra", ataque: 120, defensa: 115, vida: 340, velocidad: 20, rareza: "UR", img: "/cliente/img/behemoth.png", pasiva: "Titán: +50% Vida Máxima.", ultimate: { nombre: "Devorar", coste: 4, efecto: "lifesteal_major", desc: "Robo de vida masivo." } },
// === 🌪️ AIRE (Velocidad Alta: 85-100) ===
{ id: 19, nombre: "Águila Real", tipo: "Aire", ataque: 55, defensa: 32, vida: 85, velocidad: 90, rareza: "Común", img: "/cliente/img/aguila.png", pasiva: "Vista: Ignora evasión.", ultimate: { nombre: "Picada", coste: 4, efecto: "crit_guaranteed", desc: "Crítico asegurado." } },
{ id: 20, nombre: "Mantaraya", tipo: "Aire", ataque: 48, defensa: 45, vida: 92, velocidad: 85, rareza: "Común", img: "/cliente/img/mantarayaAire.png", pasiva: "Vuelo: Inmune a Tierra.", ultimate: { nombre: "Electroshock", coste: 4, efecto: "dmg_multi_2", desc: "Daña a 2 enemigos." } },
{ id: 21, nombre: "Grifo Real", tipo: "Aire", ataque: 76, defensa: 55, vida: 135, velocidad: 88, rareza: "Raro", img: "/cliente/img/grifo.png", pasiva: "Viento Cola: Equipo ataca primero.", ultimate: { nombre: "Vendaval", coste: 4, efecto: "dmg_bounce", desc: "Devuelve carta a mano." } },
{ id: 22, nombre: "Thunderbird", tipo: "Aire", ataque: 102, defensa: 65, vida: 165, velocidad: 95, rareza: "SSR", img: "/cliente/img/thunderbird.png", pasiva: "Batería: +1 Maná inicial.", ultimate: { nombre: "Tormenta", coste: 4, efecto: "aoe_paralyze", desc: "Daño AoE y paraliza." } },
{ id: 23, nombre: "Guardián Aéreo", tipo: "Aire", ataque: 90, defensa: 82, vida: 180, velocidad: 92, rareza: "SSR", img: "/cliente/img/guardianAire.png", pasiva: "Evasión: +10% Evasión equipo.", ultimate: { nombre: "Muro Viento", coste: 4, efecto: "team_invuln", desc: "Evasión total 1 turno." } },
{ id: 24, nombre: "Zephyr", tipo: "Aire", ataque: 135, defensa: 88, vida: 270, velocidad: 100, rareza: "UR", img: "/cliente/img/dragonAire.png", pasiva: "Intangible: 35% Evasión.", ultimate: { nombre: "Huracán", coste: 4, efecto: "aoe_mana_drain", desc: "Quita maná a rivales." } },
// === 🌑 OSCURIDAD (Velocidad: 40-50) ===
{ id: 25, nombre: "Araña Sombría", tipo: "Oscuridad", ataque: 55, defensa: 35, vida: 85, velocidad: 45, rareza: "Común", img: "/cliente/img/arana.png", pasiva: "Red: -Velocidad atacante.", ultimate: { nombre: "Veneno", coste: 4, efecto: "dmg_poison_strong", desc: "Veneno fuerte." } },
{ id: 26, nombre: "Cofre Mímico", tipo: "Oscuridad", ataque: 70, defensa: 62, vida: 130, velocidad: 40, rareza: "Raro", img: "/cliente/img/cofre.png", pasiva: "Trampa: Explota al morir.", ultimate: { nombre: "Tragar", coste: 4, efecto: "dmg_execute", desc: "Ejecuta si <50% HP." } },
{ id: 27, nombre: "Cerbero", tipo: "Oscuridad", ataque: 98, defensa: 72, vida: 175, velocidad: 50, rareza: "SSR", img: "/cliente/img/cerbero.png", pasiva: "Tres Cabezas: Ataque triple.", ultimate: { nombre: "Hades", coste: 4, efecto: "anti_heal", desc: "Impide curación." } },
{ id: 28, nombre: "Caballero Oscuro", tipo: "Oscuridad", ataque: 105, defensa: 80, vida: 185, velocidad: 42, rareza: "SSR", img: "/cliente/img/caballeroOscuro.png", pasiva: "Maldición: Devuelve 30% daño.", ultimate: { nombre: "Hoja Vacío", coste: 4, efecto: "true_dmg", desc: "Ignora defensa." } },
{ id: 29, nombre: "Ángel Caído", tipo: "Oscuridad", ataque: 138, defensa: 92, vida: 290, velocidad: 48, rareza: "UR", img: "/cliente/img/angelCaido.png", pasiva: "Aura Muerte: Enemigos pierden HP.", ultimate: { nombre: "Juicio", coste: 4, efecto: "hp_to_1", desc: "Deja enemigo a 1 HP." } },
// === ✨ LUZ (Velocidad: 70-88) ===
{ id: 30, nombre: "Polilla Lunar", tipo: "Luz", ataque: 45, defensa: 38, vida: 88, velocidad: 80, rareza: "Común", img: "/cliente/img/polilla.png", pasiva: "Brillo: 10% cegar atacante.", ultimate: { nombre: "Sueño", coste: 4, efecto: "sleep", desc: "Duerme rival 1 turno." } },
{ id: 31, nombre: "Slime Real", tipo: "Luz", ataque: 40, defensa: 48, vida: 105, velocidad: 70, rareza: "Común", img: "/cliente/img/slime.png", pasiva: "División: Revive 1 vez.", ultimate: { nombre: "Rebote", coste: 4, efecto: "dmg_shield", desc: "Daño y Escudo." } },
{ id: 32, nombre: "Unicornio", tipo: "Luz", ataque: 68, defensa: 65, vida: 145, velocidad: 78, rareza: "Raro", img: "/cliente/img/unicornio.png", pasiva: "Pureza: Limpia estados.", ultimate: { nombre: "Cuerno Luz", coste: 4, efecto: "full_heal_ally", desc: "Cura total aliado." } },
{ id: 33, nombre: "León Solar", tipo: "Luz", ataque: 100, defensa: 78, vida: 180, velocidad: 82, rareza: "SSR", img: "/cliente/img/leon.png", pasiva: "Rey Sol: Buff equipo.", ultimate: { nombre: "Explosión", coste: 4, efecto: "aoe_blind", desc: "Daña y ciega AoE." } },
{ id: 34, nombre: "Valquiria", tipo: "Luz", ataque: 128, defensa: 105, vida: 310, velocidad: 88, rareza: "UR", img: "/cliente/img/valkiria.png", pasiva: "Valhalla: Revive aliados.", ultimate: { nombre: "Luz Sagrada", coste: 4, efecto: "dmg_heal_team_equal", desc: "Daña y cura equipo." } },
// === ⚡ GOD TIER ===
{ id: 999, nombre: "ZENITH", tipo: "ORIGEN", ataque: 9999, defensa: 9999, vida: 9999, velocidad: 999, rareza: "ABSOLUTE", img: "/cliente/img/zenithEspecial.png", pasiva: "Omnipotencia: Inmune a todo.", ultimate: { nombre: "EL FIN", coste: 1, efecto: "instant_win", desc: "Victoria Instantánea." } }
];

// Alias para compatibilidad con código existente
module.exports.Animales = module.exports.Personajes;

// ==================== TABLA DE VENTAJAS DE TIPO ====================
module.exports.TablaTipos = {
    "Fuego": ["Aire"],       // Fuego quema Tierra y consume Aire
    "Agua": ["Fuego"],                  // Agua apaga Fuego
    "Tierra": ["Agua"],          // Tierra absorbe Agua y bloquea Luz
    "Aire": ["Tierra"],         // Aire evapora Agua y erosiona Tierra
    "Luz": ["Oscuridad"],       // Luz disipa Oscuridad e ilumina Aire
    "Oscuridad": ["Luz"],       // Oscuridad corrompe Luz y sofoca Fuego
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
    invocacionCien: 8000      // 100 invocaciones con mayor descuento (20% off)
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
