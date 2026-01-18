// ==================== CONFIGURACIÓN DE ENTORNO DE PRUEBAS ====================
// Configurar modo test y credenciales para evitar llamadas a GCP/Secret Manager
process.env.NODE_ENV = 'test';
process.env.MAIL_USER = process.env.MAIL_USER || 'test@example.com';
process.env.MAIL_PASS = process.env.MAIL_PASS || 'testpass';

const modelo = require("./modelo.js");
const data = require("./data.js");

// NOTA: Los mocks de CAD ya no son necesarios porque:
// 1. CAD ahora tiene verificación interna con _verificarConexion()
// 2. Sistema(true) no llama a conectar(), por lo que this.usuarios = null
// 3. Todos los métodos de CAD verifican conexión y hacen fallback si no hay
// Sin embargo, mantenemos el mock de actualizarEquipamiento que no existía antes
const cadModule = require('./cad.js');
cadModule.CAD.prototype.actualizarEquipamiento = function(usuario, cb){ 
    console.log("Equipamiento x1 guardado"); // Mantener log para compatibilidad con salida esperada
    if (cb) cb(usuario); 
};

// Helper para crear instancias de personaje mínimas para tests
// Crea una instancia válida con todos los campos necesarios para tests de partida
function crearInstanciaTest(idAnimal) {
    const animal = data.Animales.find(a => a.id === idAnimal) || data.Animales[0];
    return {
        uid: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        idAnimal: animal.id,
        nivel: 1,
        xpActual: 0,
        rangoBase: 'Estrellas',
        nivelRango: 1,
        copias: 0,
        stats: { ataque: animal.ataque, defensa: animal.defensa, vida: animal.vida },
        poder: (animal.ataque * 10) + (animal.defensa * 4) + (animal.vida * 3),
        nombre: animal.nombre,
        tipo: animal.tipo,
        rareza: animal.rareza,
        img: animal.img,
        velocidad: animal.velocidad || 50,
        pasiva: animal.pasiva || null,
        ultimate: animal.ultimate || null
    };
}

// La verificación de conexión ahora está integrada en CAD, 
// por lo que Sistema en modo test funciona correctamente sin mocks adicionales
// Solo mantenemos el wrapper para asegurar que cad existe como objeto
{
    const OriginalSistema = modelo.Sistema;
    modelo.Sistema = function(test){
        const s = new OriginalSistema(test);
        s.cad = s.cad || {};
        s.cad.actualizarInventario = function(usuario, cb){ if (cb) cb(usuario); };
        s.cad.actualizarEquipamiento = function(usuario, cb){ if (cb) cb(usuario); };
        s.cad.actualizarUsuario = function(usuario, cb){ if (cb) cb(usuario); };
        return s;
    };
}

// ==================== PRUEBAS DE USUARIOS ====================
describe('El sistema - Gestión de Usuarios', function() {
    let sistema;
    
    beforeEach(function() {
        sistema = new modelo.Sistema(true);
    });

    it('inicialmente no hay usuarios', function() {
        expect(sistema.numeroUsuarios().num).toEqual(0);
    });

    it('se puede agregar un usuario por nick', function() {
        sistema.agregarUsuario('pepe');
        expect(sistema.numeroUsuarios().num).toEqual(1);
    });

    it('se puede agregar un usuario a partir de objeto', function() {
        const obj = { email: 'obj@dominio.com', inventario: [], monedas: 42 };
        let res = sistema.agregarUsuario(obj);
        expect(res.nick).toEqual(obj.email);
        expect(res.monedas).toEqual(42);
    });

    it('manejar duplicados devuelve mismas monedas y no duplica', function() {
        const obj = { email: 'dup@dominio.com', inventario: [], monedas: 100 };
        sistema.agregarUsuario(obj);
        let res2 = sistema.agregarUsuario(obj);
        expect(res2.nick).toEqual(obj.email);
        expect(sistema.numeroUsuarios().num).toEqual(1);
    });

    it('se puede obtener los usuarios', function() {
        sistema.agregarUsuario('pepe');
        sistema.agregarUsuario('ana');
        const usuarios = sistema.obtenerUsuarios().usuarios;
        expect(Object.keys(usuarios).length).toEqual(2);
        expect(usuarios.hasOwnProperty('pepe')).toBeTrue();
        expect(usuarios.hasOwnProperty('ana')).toBeTrue();
    });

    it('se puede comprobar si un usuario existe', function() {
        sistema.agregarUsuario('pepe');
        expect(sistema.usuarioActivo('pepe').res).toBeTrue();
        expect(sistema.usuarioActivo('ana').res).toBeFalse();
    });

    it('se puede eliminar un usuario', function() {
        sistema.agregarUsuario('pepe');
        sistema.agregarUsuario('ana');
        expect(sistema.numeroUsuarios().num).toEqual(2);
        expect(sistema.eliminarUsuario('pepe').res).toBeTrue();
        expect(sistema.numeroUsuarios().num).toEqual(1);
        expect(sistema.usuarioActivo('pepe').res).toBeFalse();
        expect(sistema.usuarioActivo('ana').res).toBeTrue();
    });

    it('eliminar usuario inexistente devuelve false', function() {
        expect(sistema.eliminarUsuario('noexiste').res).toBeFalse();
    });

    it('usuario con objeto incluye equipamiento por defecto', function() {
        const obj = { email: 'equip@test.com', inventario: [], monedas: 50, equipamiento: [{id:'item1'}] };
        sistema.agregarUsuario(obj);
        let usuario = sistema.usuarios['equip@test.com'];
        expect(usuario.equipamiento.length).toEqual(1);
    });
});

// ==================== PRUEBAS DE PARTIDAS ====================
describe('Pruebas de las partidas', function() {
    let sistema;
    let usr2;
    let usr3;
    
    beforeEach(function() {
        sistema = new modelo.Sistema(true);
        usr2 = { "nick": "Pepa", "email": "pepa@pepa.es" };
        usr3 = { "nick": "Pepo", "email": "pepo@pepo.es" };
        sistema.agregarUsuario("Pepe");
        sistema.agregarUsuario(usr2.nick);
        sistema.agregarUsuario(usr3.nick);
    });

    it('Usuarios y partidas en el sistema', function() {
        expect(sistema.numeroUsuarios().num).toEqual(3);
        expect(sistema.obtenerPartidasDisponibles().length).toEqual(0);
    });

    it('Crear partida', function() {
        // Preparar inventario válido con 3 instancias
        const usuario = sistema.usuarios['Pepe'];
        usuario.inventario = [crearInstanciaTest(data.Animales[0].id), crearInstanciaTest(data.Animales[0].id), crearInstanciaTest(data.Animales[0].id)];
        const equipoUIDs = usuario.inventario.map(i => i.uid);
        let res = sistema.crearPartida('Pepe', equipoUIDs);
        expect(res.codigo).toBeDefined();
        expect(sistema.partidas[res.codigo]).toBeDefined();
        expect(sistema.partidas[res.codigo].jugadores.length).toEqual(1);
        expect(sistema.partidas[res.codigo].jugadores[0].nick).toEqual('Pepe');
    });

    it('Unir a partida', function() {
        // Preparar inventarios válidos
        const usuario1 = sistema.usuarios['Pepe'];
        usuario1.inventario = [crearInstanciaTest(data.Animales[0].id), crearInstanciaTest(data.Animales[0].id), crearInstanciaTest(data.Animales[0].id)];
        const usuario2 = sistema.usuarios[usr2.nick];
        usuario2.inventario = [crearInstanciaTest(data.Animales[1].id), crearInstanciaTest(data.Animales[1].id), crearInstanciaTest(data.Animales[1].id)];
        let res = sistema.crearPartida('Pepe', usuario1.inventario.map(i => i.uid));
        sistema.unirAPartida(usr2.nick, res.codigo, usuario2.inventario.map(i => i.uid));
        expect(sistema.partidas[res.codigo].jugadores.length).toEqual(2);
        expect(sistema.partidas[res.codigo].jugadores[1].nick).toEqual(usr2.nick);
    });

    it('Un usuario no puede estar dos veces', function() {
        const usuario = sistema.usuarios['Pepe'];
        usuario.inventario = [crearInstanciaTest(data.Animales[0].id), crearInstanciaTest(data.Animales[0].id), crearInstanciaTest(data.Animales[0].id)];
        let res = sistema.crearPartida('Pepe', usuario.inventario.map(i => i.uid));
        // Intentar unir el mismo usuario
        sistema.unirAPartida('Pepe', res.codigo, usuario.inventario.map(i => i.uid));
        expect(sistema.partidas[res.codigo].jugadores.length).toEqual(1);
    });

    it('Obtener partidas disponibles', function() {
        const usuario = sistema.usuarios['Pepe'];
        usuario.inventario = [crearInstanciaTest(data.Animales[0].id), crearInstanciaTest(data.Animales[0].id), crearInstanciaTest(data.Animales[0].id)];
        const usuario2 = sistema.usuarios[usr2.nick];
        usuario2.inventario = [crearInstanciaTest(data.Animales[1].id), crearInstanciaTest(data.Animales[1].id), crearInstanciaTest(data.Animales[1].id)];
        let res = sistema.crearPartida('Pepe', usuario.inventario.map(i => i.uid));
        let lista = sistema.obtenerPartidasDisponibles();
        expect(lista.length).toEqual(1);
        expect(lista[0].codigo).toEqual(res.codigo);
        
        sistema.unirAPartida(usr2.nick, res.codigo, usuario2.inventario.map(i => i.uid));
        lista = sistema.obtenerPartidasDisponibles();
        expect(lista.length).toEqual(0);
    });

    it('Eliminar partida propia', function() {
        const usuario = sistema.usuarios['Pepe'];
        usuario.inventario = [crearInstanciaTest(data.Animales[0].id), crearInstanciaTest(data.Animales[0].id), crearInstanciaTest(data.Animales[0].id)];
        let resCreate = sistema.crearPartida('Pepe', usuario.inventario.map(i => i.uid));
        let res = sistema.eliminarPartida(resCreate.codigo, 'Pepe');
        expect(res.codigo).toEqual(resCreate.codigo);
        expect(sistema.partidas[resCreate.codigo]).toBeUndefined();
    });

    it('No se puede eliminar partida ajena', function() {
        const usuario = sistema.usuarios['Pepe'];
        usuario.inventario = [crearInstanciaTest(data.Animales[0].id), crearInstanciaTest(data.Animales[0].id), crearInstanciaTest(data.Animales[0].id)];
        let resCreate = sistema.crearPartida('Pepe', usuario.inventario.map(i => i.uid));
        let res = sistema.eliminarPartida(resCreate.codigo, usr2.nick);
        expect(res.codigo).toEqual(-1);
    });

    it('No se puede eliminar partida con más de un jugador', function() {
        const usuario = sistema.usuarios['Pepe'];
        usuario.inventario = [crearInstanciaTest(data.Animales[0].id), crearInstanciaTest(data.Animales[0].id), crearInstanciaTest(data.Animales[0].id)];
        const usuario2 = sistema.usuarios[usr2.nick];
        usuario2.inventario = [crearInstanciaTest(data.Animales[1].id), crearInstanciaTest(data.Animales[1].id), crearInstanciaTest(data.Animales[1].id)];
        let resCreate = sistema.crearPartida('Pepe', usuario.inventario.map(i => i.uid));
        sistema.unirAPartida(usr2.nick, resCreate.codigo, usuario2.inventario.map(i => i.uid));
        let res = sistema.eliminarPartida(resCreate.codigo, 'Pepe');
        expect(res.codigo).toEqual(-1);
    });

    it('obtenerCodigo genera códigos únicos', function() {
        let c1 = sistema.obtenerCodigo();
        let c2 = sistema.obtenerCodigo();
        expect(c1).not.toEqual(c2);
    });
});

// ==================== PRUEBAS DE VALIDACIÓN DE EQUIPO ====================
describe('Pruebas de validación de equipo', function() {
    let sistema;
    
    beforeEach(function() {
        sistema = new modelo.Sistema(true);
    });

    it('validarEquipo acepta equipo válido de 3 personajes', function() {
        const usuario = { inventario: [{ uid: 'u1' }, { uid: 'u2' }, { uid: 'u3' }] };
        let res = sistema.validarEquipo(usuario, ['u1', 'u2', 'u3']);
        expect(res.valido).toBeTrue();
        expect(res.equipo.length).toEqual(3);
    });

    it('validarEquipo rechaza equipo con personaje inexistente', function() {
        const usuario = { inventario: [{ uid: 'u1' }, { uid: 'u2' }, { uid: 'u3' }] };
        let res = sistema.validarEquipo(usuario, ['u1', 'x', 'u3']);
        expect(res.valido).toBeFalse();
    });

    it('validarEquipo rechaza equipo con menos de 3 personajes', function() {
        const usuario = { inventario: [{ uid: 'u1' }, { uid: 'u2' }] };
        let res = sistema.validarEquipo(usuario, ['u1', 'u2']);
        expect(res.valido).toBeFalse();
    });

    it('validarEquipo rechaza equipo null o undefined', function() {
        const usuario = { inventario: [{ uid: 'u1' }] };
        let res = sistema.validarEquipo(usuario, null);
        expect(res.valido).toBeFalse();
    });
});

// ==================== PRUEBAS DE CONSTRUCCIÓN DE LUCHADOR ====================
describe('Pruebas de construirLuchador', function() {
    let sistema;
    
    beforeEach(function() {
        sistema = new modelo.Sistema(true);
    });

    it('construirLuchador devuelve datos consistentes para Salamandra (id 1)', function() {
        const instancia = { uid: 'abc', idAnimal: 1, stats: { ataque: 30, defensa: 10, vida: 80 }, equipo: null, nivel: 1, rango: 1 };
        const luch = sistema.construirLuchador(instancia);
        expect(luch).toBeDefined();
        expect(luch.uid).toEqual('abc');
        expect(luch.idAnimal).toEqual(1);
        expect(luch.nombre).toEqual('Salamandra');
        expect(typeof luch.ataque).toEqual('number');
        expect(luch.mana).toEqual(0);
        expect(luch.manaMax).toEqual(4);
        expect(luch.estado).toEqual('activo');
    });

    it('construirLuchador devuelve null para animal inexistente', function() {
        const instancia = { uid: 'xyz', idAnimal: 99999, stats: { ataque: 10, defensa: 10, vida: 50 }, equipo: null, nivel: 1, rango: 1 };
        const luch = sistema.construirLuchador(instancia);
        expect(luch).toBeNull();
    });

    it('construirLuchador incluye velocidad y pasiva del animal', function() {
        const instancia = { uid: 'test', idAnimal: 1, stats: { ataque: 45, defensa: 35, vida: 90 }, equipo: null, nivel: 1, rango: 1 };
        const luch = sistema.construirLuchador(instancia);
        expect(luch.velocidad).toBeDefined();
        expect(luch.pasiva).toBeDefined();
    });
});

// ==================== PRUEBAS DE CÁLCULO DE VELOCIDAD ====================
describe('Pruebas de calcularVelocidadEquipo', function() {
    let sistema;
    
    beforeEach(function() {
        sistema = new modelo.Sistema(true);
    });

    it('suma velocidades correctamente', function() {
        const equipo = [{ velocidad: 40 }, { velocidad: 60 }, { velocidad: 50 }];
        expect(sistema.calcularVelocidadEquipo(equipo)).toEqual(150);
    });

    it('usa valor por defecto 50 si no hay velocidad', function() {
        const equipo = [{ velocidad: 40 }, {}, { velocidad: 60 }];
        expect(sistema.calcularVelocidadEquipo(equipo)).toEqual(150);
    });

    it('equipo vacío devuelve 0', function() {
        expect(sistema.calcularVelocidadEquipo([])).toEqual(0);
    });
});

// ==================== PRUEBAS DE APLICAR DAÑO ====================
describe('Pruebas de aplicarDanio', function() {
    let sistema;
    
    beforeEach(function() {
        sistema = new modelo.Sistema(true);
    });

    it('aplica daño considerando defensa', function() {
        const objetivo = { nombre: 'Enemigo', vida: 100, vidaActual: 100, defensa: 20, escudo: 0, estado: 'activo', mana: 0, manaMax: 4, estados: [] };
        let res = sistema.aplicarDanio(objetivo, 50);
        expect(res.danioReal).toBeLessThan(50);
        expect(res.vidaDespues).toBeLessThan(100);
    });

    it('aplica daño y el objetivo gana maná si sigue vivo', function() {
        const objetivo = { nombre: 'Enemigo', vida: 100, vidaActual: 100, defensa: 10, escudo: 0, estado: 'activo', mana: 0, manaMax: 4, estados: [] };
        let res = sistema.aplicarDanio(objetivo, 30);
        if (!res.derrotado && res.danioReal > 0) {
            expect(res.manaGanado).toBeTrue();
        }
    });

    it('escudo absorbe daño antes de afectar vida', function() {
        const objetivo = { nombre: 'Escudado', vida: 100, vidaActual: 100, defensa: 0, escudo: 50, estado: 'activo', mana: 0, manaMax: 4, estados: [] };
        let res = sistema.aplicarDanio(objetivo, 30);
        expect(res.escudoAbsorbido).toBeGreaterThan(0);
        expect(objetivo.escudo).toBeLessThan(50);
    });

    it('respeta invulnerabilidad', function() {
        const objetivo = { nombre: 'Inv', vida: 50, vidaActual: 50, defensa: 0, escudo: 0, estados: [{ tipo: 'invulnerable' }], estado: 'activo', mana: 0, manaMax: 4 };
        let res = sistema.aplicarDanio(objetivo, 100);
        expect(res.danioReal).toEqual(0);
        expect(res.bloqueado).toBeTrue();
    });

    it('marca derrotado cuando vida llega a 0', function() {
        const objetivo = { nombre: 'Débil', vida: 20, vidaActual: 20, defensa: 0, escudo: 0, estado: 'activo', mana: 0, manaMax: 4, estados: [] };
        let res = sistema.aplicarDanio(objetivo, 100);
        expect(res.derrotado).toBeTrue();
        expect(objetivo.estado).toEqual('derrotado');
    });
});

// ==================== PRUEBAS DE APLICAR DAÑO DIRECTO ====================
describe('Pruebas de aplicarDanioDirecto', function() {
    let sistema;
    
    beforeEach(function() {
        sistema = new modelo.Sistema(true);
    });

    it('ignora defensa completamente', function() {
        const objetivo = { nombre: 'Target', vida: 100, vidaActual: 100, defensa: 50, estado: 'activo', mana: 0, manaMax: 4, estados: [] };
        let res = sistema.aplicarDanioDirecto(objetivo, 30);
        expect(res.danioReal).toEqual(30);
        expect(objetivo.vidaActual).toEqual(70);
    });

    it('respeta invulnerabilidad', function() {
        const objetivo = { nombre: 'InvDir', vida: 50, vidaActual: 50, defensa: 10, estados: [{ tipo: 'invulnerable' }], estado: 'activo', mana: 0, manaMax: 4 };
        let res = sistema.aplicarDanioDirecto(objetivo, 100);
        expect(res.danioReal).toEqual(0);
        expect(res.bloqueado).toBeTrue();
    });

    it('marca derrotado correctamente', function() {
        const objetivo = { nombre: 'Weak', vida: 50, vidaActual: 50, defensa: 100, estado: 'activo', mana: 0, manaMax: 4, estados: [] };
        let res = sistema.aplicarDanioDirecto(objetivo, 60);
        expect(res.derrotado).toBeTrue();
        expect(objetivo.estado).toEqual('derrotado');
    });
});

// ==================== PRUEBAS DE ESTADOS ====================
describe('Pruebas de tieneEstado y puedeActuar', function() {
    let sistema;
    
    beforeEach(function() {
        sistema = new modelo.Sistema(true);
    });

    it('tieneEstado detecta estado existente', function() {
        const p = { estados: [{ tipo: 'congelado' }], estado: 'activo' };
        expect(sistema.tieneEstado(p, 'congelado')).toBeTrue();
        expect(sistema.tieneEstado(p, 'envenenado')).toBeFalse();
    });

    it('tieneEstado devuelve false para personaje sin estados', function() {
        const p = { estado: 'activo' };
        expect(sistema.tieneEstado(p, 'congelado')).toBeFalse();
    });

    it('puedeActuar devuelve false si está congelado', function() {
        const p = { estados: [{ tipo: 'congelado' }], estado: 'activo' };
        expect(sistema.puedeActuar(p)).toBeFalse();
    });

    it('puedeActuar devuelve false si está aturdido', function() {
        const p = { estados: [{ tipo: 'aturdido' }], estado: 'activo' };
        expect(sistema.puedeActuar(p)).toBeFalse();
    });

    it('puedeActuar devuelve false si está paralizado', function() {
        const p = { estados: [{ tipo: 'paralizado' }], estado: 'activo' };
        expect(sistema.puedeActuar(p)).toBeFalse();
    });

    it('puedeActuar devuelve false si está dormido', function() {
        const p = { estados: [{ tipo: 'dormido' }], estado: 'activo' };
        expect(sistema.puedeActuar(p)).toBeFalse();
    });

    it('puedeActuar devuelve true si no tiene estados de control', function() {
        const p = { estados: [{ tipo: 'envenenado' }], estado: 'activo' };
        expect(sistema.puedeActuar(p)).toBeTrue();
    });

    it('puedeActuar devuelve true si estados está vacío', function() {
        const p = { estados: [], estado: 'activo' };
        expect(sistema.puedeActuar(p)).toBeTrue();
    });

    it('puedeActuar devuelve false si personaje está derrotado', function() {
        const p = { estados: [], estado: 'derrotado' };
        expect(sistema.puedeActuar(p)).toBeFalse();
    });
});

// ==================== PRUEBAS DE INMUNIDADES ====================
describe('Pruebas de esInmuneAEstado', function() {
    let sistema;
    
    beforeEach(function() {
        sistema = new modelo.Sistema(true);
    });

    it('detecta inmunidad Inamovible a stun y congelación', function() {
        const p = { pasiva: 'Inamovible: Inmune a stun y congelación' };
        expect(sistema.esInmuneAEstado(p, 'congelado')).toBeTrue();
        expect(sistema.esInmuneAEstado(p, 'aturdido')).toBeTrue();
    });

    it('detecta inmunidad a quemadura por Espíritu Ígneo', function() {
        const p = { pasiva: 'Espíritu Ígneo: Inmune a quemadura' };
        expect(sistema.esInmuneAEstado(p, 'quemado')).toBeTrue();
    });

    it('detecta Omnipotencia inmune a todo', function() {
        const p = { pasiva: 'Omnipotencia: Inmune a todo' };
        expect(sistema.esInmuneAEstado(p, 'congelado')).toBeTrue();
        expect(sistema.esInmuneAEstado(p, 'envenenado')).toBeTrue();
        expect(sistema.esInmuneAEstado(p, 'aturdido')).toBeTrue();
    });

    it('devuelve false si no tiene pasiva de inmunidad', function() {
        const p = { pasiva: 'Carga: Primer ataque +50% daño' };
        expect(sistema.esInmuneAEstado(p, 'congelado')).toBeFalse();
    });

    it('devuelve false si personaje no tiene pasiva', function() {
        const p = {};
        expect(sistema.esInmuneAEstado(p, 'congelado')).toBeFalse();
    });
});

// ==================== PRUEBAS DE STATS CON EQUIPAMIENTO ====================
describe('Pruebas de calcularStatsConEquipamientoYSinergia', function() {
    let sistema;
    
    beforeEach(function() {
        sistema = new modelo.Sistema(true);
    });

    it('devuelve stats base si no hay equipamiento', function() {
        const statsBase = { ataque: 100, defensa: 50, vida: 500 };
        const res = sistema.calcularStatsConEquipamientoYSinergia(statsBase, null, 'Fuego');
        expect(res.ataque).toEqual(100);
        expect(res.defensa).toEqual(50);
        expect(res.vida).toEqual(500);
    });

    it('duplica stats cuando elemento coincide (sinergia)', function() {
        const statsBase = { ataque: 100, defensa: 50, vida: 500 };
        const equipo = {
            casco: { stats: { ataque: 10, defensa: 0, vida: 0 }, elemento: 'Fuego' },
            pechera: null, pantalones: null, zapatos: null, arma: null
        };
        const res = sistema.calcularStatsConEquipamientoYSinergia(statsBase, equipo, 'Fuego');
        expect(res.ataque).toBeGreaterThan(100);
    });

    it('no duplica stats si elemento no coincide', function() {
        const statsBase = { ataque: 100, defensa: 50, vida: 500 };
        const equipo = {
            casco: { stats: { ataque: 10, defensa: 0, vida: 0 }, elemento: 'Agua' },
            pechera: null, pantalones: null, zapatos: null, arma: null
        };
        const res = sistema.calcularStatsConEquipamientoYSinergia(statsBase, equipo, 'Fuego');
        expect(res.ataque).toEqual(110); // 100 + 10
    });
});

// ==================== PRUEBAS DE PASIVAS ====================
describe('Pruebas de checkPasiva y tieneVientoCola', function() {
    let sistema;
    
    beforeEach(function() {
        sistema = new modelo.Sistema(true);
    });

    it('checkPasiva devuelve null para personaje sin pasiva', function() {
        const personaje = { nombre: 'X' };
        expect(sistema.checkPasiva(personaje, 'inicio_turno', {})).toBeNull();
    });

    it('tieneVientoCola detecta pasiva en equipo', function() {
        const equipo = [{ pasiva: 'Viento Cola: ataca primero' }, { pasiva: '' }];
        expect(sistema.tieneVientoCola(equipo)).toBeTrue();
    });

    it('tieneVientoCola devuelve false si no hay pasiva', function() {
        const equipo = [{ pasiva: 'Otra pasiva' }, { pasiva: '' }];
        expect(sistema.tieneVientoCola(equipo)).toBeFalse();
    });
});

// ==================== PRUEBAS DE DATOS (data.js) ====================
describe('Pruebas de datos del juego (data.js)', function() {
    it('Animales/Personajes tiene al menos 35 personajes', function() {
        expect(data.Animales.length).toBeGreaterThanOrEqual(35);
    });

    it('cada animal tiene propiedades requeridas', function() {
        data.Animales.forEach(animal => {
            expect(animal.id).toBeDefined();
            expect(animal.nombre).toBeDefined();
            expect(animal.tipo).toBeDefined();
            expect(animal.ataque).toBeDefined();
            expect(animal.defensa).toBeDefined();
            expect(animal.vida).toBeDefined();
            expect(animal.rareza).toBeDefined();
        });
    });

    it('TablaTipos tiene todas las relaciones elementales', function() {
        expect(data.TablaTipos.Fuego).toBeDefined();
        expect(data.TablaTipos.Agua).toBeDefined();
        expect(data.TablaTipos.Tierra).toBeDefined();
        expect(data.TablaTipos.Aire).toBeDefined();
        expect(data.TablaTipos.Luz).toBeDefined();
        expect(data.TablaTipos.Oscuridad).toBeDefined();
    });

    it('RangosBase tiene 9 rangos', function() {
        expect(data.RangosBase.length).toEqual(9);
    });

    it('Costos están definidos', function() {
        expect(data.Costos.invocacionSimple).toBeDefined();
        expect(data.Costos.invocacionMultiple).toBeDefined();
    });

    it('ProbabilidadesGacha suman 100', function() {
        const probs = data.ProbabilidadesGacha;
        const suma = probs.UR + probs.SSR + probs.Raro + probs.Común;
        expect(suma).toEqual(100);
    });

    it('LimiteEvolucionPorRareza está definido para cada rareza', function() {
        expect(data.LimiteEvolucionPorRareza.Común).toBeDefined();
        expect(data.LimiteEvolucionPorRareza.Raro).toBeDefined();
        expect(data.LimiteEvolucionPorRareza.SSR).toBeDefined();
        expect(data.LimiteEvolucionPorRareza.UR).toBeDefined();
        expect(data.LimiteEvolucionPorRareza.ABSOLUTE).toBeDefined();
    });
});

// ==================== PRUEBAS DE GACHA/INVOCACIÓN ====================
describe('Pruebas de sistema de invocación', function() {
    let sistema;
    let usuario;
    
    beforeEach(function() {
        sistema = new modelo.Sistema(true);
        usuario = { email: 'test@test.com', monedas: 10000, inventario: [], equipamiento: [] };
        sistema.agregarUsuario(usuario);
        sistema.usuarios[usuario.email] = usuario;
    });

    it('invocar sin monedas suficientes devuelve null', function() {
        usuario.monedas = 0;
        let res = sistema.invocarGacha(usuario);
        expect(res).toBeNull();
    });

    it('invocar descuenta monedas', function() {
        const monedasAntes = usuario.monedas;
        sistema.invocarGacha(usuario);
        expect(usuario.monedas).toBeLessThan(monedasAntes);
    });

    it('invocar añade personaje al inventario', function() {
        sistema.invocarGacha(usuario);
        expect(usuario.inventario.length).toBeGreaterThanOrEqual(1);
    });

    it('invocar10 añade hasta 10 personajes o incrementa copias', function() {
        sistema.invocarGachaMultiple(usuario);
        // El inventario puede tener menos de 10 si hay duplicados que incrementan copias
        expect(usuario.inventario.length).toBeGreaterThanOrEqual(1);
    });
});

// ==================== PRUEBAS DE EQUIPAMIENTO ====================
describe('Pruebas de sistema de equipamiento', function() {
    let sistema;
    let usuario;
    
    beforeEach(function() {
        sistema = new modelo.Sistema(true);
        usuario = { email: 'equip@test.com', monedas: 50000, inventario: [], equipamiento: [] };
        sistema.agregarUsuario(usuario);
        sistema.usuarios[usuario.email] = usuario;
    });

    it('invocarEquipamiento devuelve null si no hay monedas', function() {
        usuario.monedas = 0;
        let res = sistema.invocarEquipamiento(usuario, 1);
        expect(res).toBeNull();
    });

    it('invocarEquipamiento añade items al equipamiento', function() {
        let res = sistema.invocarEquipamiento(usuario, 1);
        expect(res).not.toBeNull();
        expect(usuario.equipamiento.length).toEqual(1);
    });

    it('obtenerEquipamiento devuelve array de equipamiento', function() {
        sistema.invocarEquipamiento(usuario, 1);
        let equipo = sistema.obtenerEquipamiento(usuario);
        expect(Array.isArray(equipo)).toBeTrue();
        expect(equipo.length).toEqual(1);
    });

    it('obtenerInfoInventarioEquipamiento devuelve info correcta', function() {
        sistema.invocarEquipamiento(usuario, 10);
        let info = sistema.obtenerInfoInventarioEquipamiento(usuario);
        expect(info.actual).toEqual(10);
        expect(info.maximo).toEqual(300);
        expect(info.espacioLibre).toEqual(290);
    });

    it('eliminarEquipamiento devuelve error si item no existe', function() {
        let res = sistema.eliminarEquipamiento(usuario, 'itemInexistente');
        expect(res.error).toBeTrue();
    });

    it('eliminarEquipamiento elimina item y devuelve recompensa', function() {
        sistema.invocarEquipamiento(usuario, 1);
        const itemId = usuario.equipamiento[0].id;
        const monedasAntes = usuario.monedas;
        let res = sistema.eliminarEquipamiento(usuario, itemId);
        expect(res.exito).toBeTrue();
        expect(usuario.monedas).toBeGreaterThan(monedasAntes);
        expect(usuario.equipamiento.length).toEqual(0);
    });
});

// ==================== PRUEBAS DE EVOLUCIÓN ====================
describe('Pruebas de sistema de evolución', function() {
    let sistema;
    let usuario;
    
    beforeEach(function() {
        sistema = new modelo.Sistema(true);
        usuario = { email: 'evo@test.com', monedas: 5000, inventario: [], equipamiento: [] };
        sistema.agregarUsuario(usuario);
        sistema.usuarios[usuario.email] = usuario;
        // Añadir un personaje con copias para poder evolucionar
        sistema.invocarGacha(usuario);
    });

    it('evolucionarPersonaje sin copias devuelve error', function() {
        if (usuario.inventario.length > 0) {
            const uid = usuario.inventario[0].uid;
            usuario.inventario[0].copias = 0;
            let res = sistema.evolucionarPersonaje(usuario, uid);
            expect(res.exito).toBeFalse();
        }
    });

    it('evolucionarPersonaje con copias sube de rango', function() {
        if (usuario.inventario.length > 0) {
            const inst = usuario.inventario[0];
            inst.copias = 5;
            inst.rangoBase = 'Estrellas';
            inst.nivelRango = 1;
            let res = sistema.evolucionarPersonaje(usuario, inst.uid);
            expect(res.exito).toBeTrue();
            expect(inst.nivelRango).toEqual(2);
        }
    });

    it('evolucionarPersonaje inexistente devuelve error', function() {
        let res = sistema.evolucionarPersonaje(usuario, 'uidInexistente');
        expect(res.exito).toBeFalse();
    });
});

// ==================== PRUEBAS DE INVENTARIO ====================
describe('Pruebas de obtenerInventario', function() {
    let sistema;
    let usuario;
    
    beforeEach(function() {
        sistema = new modelo.Sistema(true);
        usuario = { email: 'inv@test.com', monedas: 5000, inventario: [], equipamiento: [] };
        sistema.agregarUsuario(usuario);
        sistema.usuarios[usuario.email] = usuario;
    });

    it('inventario vacío devuelve array vacío', function() {
        let inv = sistema.obtenerInventario(usuario);
        expect(inv.length).toEqual(0);
    });

    it('inventario con personajes devuelve datos completos', function() {
        sistema.invocarGacha(usuario);
        let inv = sistema.obtenerInventario(usuario);
        expect(inv.length).toBeGreaterThanOrEqual(1);
        expect(inv[0].nombre).toBeDefined();
        expect(inv[0].poder).toBeDefined();
    });

    it('inventario está ordenado por poder descendente', function() {
        sistema.invocarGachaMultiple(usuario);
        let inv = sistema.obtenerInventario(usuario);
        if (inv.length >= 2) {
            expect(inv[0].poder).toBeGreaterThanOrEqual(inv[1].poder);
        }
    });
});

// ==================== PRUEBAS DE PODER ====================
describe('Pruebas de calcularPoderUsuario', function() {
    let sistema;
    let usuario;
    
    beforeEach(function() {
        sistema = new modelo.Sistema(true);
        usuario = { email: 'poder@test.com', monedas: 10000, inventario: [], equipamiento: [] };
        sistema.agregarUsuario(usuario);
        sistema.usuarios[usuario.email] = usuario;
    });

    it('usuario sin personajes tiene poder 0', function() {
        let res = sistema.calcularPoderUsuario(usuario);
        expect(res.poderTotal).toEqual(0);
    });

    it('poder se calcula con top 3 personajes', function() {
        sistema.invocarGachaMultiple(usuario);
        let res = sistema.calcularPoderUsuario(usuario);
        expect(res.poderTotal).toBeGreaterThan(0);
        expect(res.top3.length).toBeLessThanOrEqual(3);
    });
});

// ==================== PRUEBAS DE CIFRADO DE CONTRASEÑAS ====================
describe('Pruebas de cifrado de contraseñas', function() {
    let sistema;
    
    beforeEach(function() {
        sistema = new modelo.Sistema(true);
    });

    it('cifrarContraseña genera hash diferente al original', function(done) {
        sistema.cifrarContraseña('miPassword123', function(hash) {
            expect(hash).not.toEqual('miPassword123');
            expect(hash.length).toBeGreaterThan(10);
            done();
        });
    });

    it('compararContraseña devuelve true para contraseña correcta', function(done) {
        sistema.cifrarContraseña('testPass', function(hash) {
            sistema.compararContraseña('testPass', hash, function(res) {
                expect(res).toBeTrue();
                done();
            });
        });
    });

    it('compararContraseña devuelve false para contraseña incorrecta', function(done) {
        sistema.cifrarContraseña('testPass', function(hash) {
            sistema.compararContraseña('wrongPass', hash, function(res) {
                expect(res).toBeFalse();
                done();
            });
        });
    });
});

// ==================== PRUEBAS DE EQUIPAR ITEMS ====================
describe('Pruebas de equipar items a personajes', function() {
    let sistema;
    let usuario;
    
    beforeEach(function() {
        sistema = new modelo.Sistema(true);
        usuario = { email: 'equip2@test.com', monedas: 50000, inventario: [], equipamiento: [] };
        sistema.agregarUsuario(usuario);
        sistema.usuarios[usuario.email] = usuario;
        sistema.invocarGacha(usuario);
        sistema.invocarEquipamiento(usuario, 1);
    });

    it('equiparItem a personaje inexistente devuelve error', function() {
        const itemId = usuario.equipamiento[0].id;
        let res = sistema.equiparItem(usuario, itemId, 'uidInexistente');
        expect(res.error).toBeTrue();
    });

    it('equiparItem con item inexistente devuelve error', function() {
        const personajeUid = usuario.inventario[0].uid;
        let res = sistema.equiparItem(usuario, 'itemInexistente', personajeUid);
        expect(res.error).toBeTrue();
    });

    it('equiparItem asigna item al personaje', function() {
        const item = usuario.equipamiento[0];
        const personaje = usuario.inventario[0];
        let res = sistema.equiparItem(usuario, item.id, personaje.uid);
        expect(res.exito).toBeTrue();
        expect(item.equipadoEn).toEqual(personaje.uid);
    });
});

// ==================== PRUEBAS DE XP Y NIVELACIÓN ====================
describe('Pruebas de aplicarXPEquipo', function() {
    let sistema;
    let usuario;
    
    beforeEach(function() {
        sistema = new modelo.Sistema(true);
        usuario = { email: 'xp@test.com', monedas: 5000, inventario: [], equipamiento: [] };
        sistema.agregarUsuario(usuario);
        sistema.usuarios[usuario.email] = usuario;
        sistema.invocarGacha(usuario);
    });

    it('aplicar XP incrementa xpActual del personaje', function() {
        if (usuario.inventario.length > 0) {
            const uid = usuario.inventario[0].uid;
            usuario.inventario[0].xpActual = 0;
            usuario.inventario[0].nivel = 1;
            let resultados = sistema.aplicarXPEquipo(usuario, [uid], 50);
            expect(resultados.length).toEqual(1);
            expect(resultados[0].xpGanada).toEqual(50);
        }
    });

    it('XP suficiente sube de nivel', function() {
        if (usuario.inventario.length > 0) {
            const inst = usuario.inventario[0];
            inst.xpActual = 0;
            inst.nivel = 1;
            // XP necesaria nivel 1 = 100, damos 150
            let resultados = sistema.aplicarXPEquipo(usuario, [inst.uid], 150);
            expect(resultados[0].subioNivel).toBeTrue();
            expect(inst.nivel).toBeGreaterThan(1);
        }
    });
});

// ==================== PRUEBAS DE ESTADO DE MESA ====================
describe('Pruebas de obtenerEstadoMesa', function() {
    let sistema;
    
    beforeEach(function() {
        sistema = new modelo.Sistema(true);
        sistema.agregarUsuario('Player1');
        sistema.agregarUsuario('Player2');
    });

    it('devuelve null para partida inexistente', function() {
        let estado = sistema.obtenerEstadoMesa('codigoInexistente');
        expect(estado).toBeNull();
    });

    it('devuelve estado correcto para partida existente', function() {
        // Preparar inventarios y crear partida
        const p1 = sistema.usuarios['Player1'];
        p1.inventario = [crearInstanciaTest(data.Animales[0].id), crearInstanciaTest(data.Animales[0].id), crearInstanciaTest(data.Animales[0].id)];
        const p2 = sistema.usuarios['Player2'];
        p2.inventario = [crearInstanciaTest(data.Animales[1].id), crearInstanciaTest(data.Animales[1].id), crearInstanciaTest(data.Animales[1].id)];
        let res = sistema.crearPartida('Player1', p1.inventario.map(i => i.uid));
        sistema.unirAPartida('Player2', res.codigo, p2.inventario.map(i => i.uid));
        let estado = sistema.obtenerEstadoMesa(res.codigo);
        expect(estado).not.toBeNull();
        expect(estado.codigo).toEqual(res.codigo);
        expect(estado.jugadores).toBeDefined();
    });
});

// ==================== PRUEBAS DE EQUIPO DERROTADO ====================
describe('Pruebas de equipoDerrotado', function() {
    let sistema;
    
    beforeEach(function() {
        sistema = new modelo.Sistema(true);
    });

    it('equipo con todos derrotados devuelve true', function() {
        const equipo = [
            { estado: 'derrotado' },
            { estado: 'derrotado' },
            { estado: 'derrotado' }
        ];
        expect(sistema.equipoDerrotado(equipo)).toBeTrue();
    });

    it('equipo con alguno activo devuelve false', function() {
        const equipo = [
            { estado: 'derrotado' },
            { estado: 'activo' },
            { estado: 'derrotado' }
        ];
        expect(sistema.equipoDerrotado(equipo)).toBeFalse();
    });

    it('equipo vacío devuelve true', function() {
        expect(sistema.equipoDerrotado([])).toBeTrue();
    });
});

// ==================== PRUEBAS DE VALIDACIÓN DE DATOS (data.js) ====================
describe('Pruebas de integridad de datos del juego', function() {
    
    it('cada personaje tiene un id único', function() {
        const ids = data.Animales.map(a => a.id);
        const idsUnicos = new Set(ids);
        expect(ids.length).toEqual(idsUnicos.size);
    });

    it('cada personaje tiene un nombre único', function() {
        const nombres = data.Animales.map(a => a.nombre);
        const nombresUnicos = new Set(nombres);
        expect(nombres.length).toEqual(nombresUnicos.size);
    });

    it('todos los tipos de personaje están definidos en TablaTipos', function() {
        const tiposUsados = new Set(data.Animales.map(a => a.tipo));
        tiposUsados.forEach(tipo => {
            expect(data.TablaTipos[tipo]).toBeDefined();
        });
    });

    it('todos los personajes SSR y UR tienen ultimate', function() {
        const rarosYLegendarios = data.Animales.filter(a => 
            ['SSR', 'UR', 'ABSOLUTE'].includes(a.rareza)
        );
        rarosYLegendarios.forEach(animal => {
            expect(animal.ultimate).toBeDefined();
            expect(animal.ultimate.nombre).toBeDefined();
            expect(animal.ultimate.efecto).toBeDefined();
        });
    });

    it('Costos tienen valores coherentes (múltiple < 10*simple)', function() {
        expect(data.Costos.invocacionMultiple).toBeLessThan(data.Costos.invocacionSimple * 10);
        expect(data.Costos.equipamientoMultiple).toBeLessThan(data.Costos.equipamientoSimple * 10);
    });

    it('FondosBatalla tiene todos los tipos elementales básicos', function() {
        const tiposFondo = data.FondosBatalla.map(f => f.tipo);
        expect(tiposFondo).toContain('Fuego');
        expect(tiposFondo).toContain('Agua');
        expect(tiposFondo).toContain('Tierra');
        expect(tiposFondo).toContain('Aire');
    });
});

// ==================== PRUEBAS DE ROBUSTEZ Y EDGE CASES ====================
describe('Pruebas de robustez y casos límite', function() {
    let sistema;
    
    beforeEach(function() {
        sistema = new modelo.Sistema(true);
    });

    it('aplicarDanio maneja objetivo sin estados correctamente', function() {
        const objetivo = { nombre: 'Test', vida: 100, vidaActual: 100, defensa: 0, estado: 'activo', mana: 0, manaMax: 4 };
        // Sin array estados
        let res = sistema.aplicarDanio(objetivo, 10);
        expect(res.danioReal).toBeGreaterThan(0);
    });

    it('aplicarDanio con daño 0 no causa error', function() {
        const objetivo = { nombre: 'Test', vida: 100, vidaActual: 100, defensa: 10, escudo: 0, estado: 'activo', mana: 0, manaMax: 4, estados: [] };
        let res = sistema.aplicarDanio(objetivo, 0);
        expect(res.danioReal).toEqual(0);
        expect(objetivo.vidaActual).toEqual(100);
    });

    it('validarEquipo maneja usuario sin inventario', function() {
        const usuario = {}; // Sin inventario
        let res = sistema.validarEquipo(usuario, ['u1', 'u2', 'u3']);
        expect(res.valido).toBeFalse();
    });

    it('construirLuchador maneja instancia con stats incompletos', function() {
        const instancia = { uid: 'test', idAnimal: 1, stats: { ataque: 50 }, nivel: 1, rango: 1 };
        const luch = sistema.construirLuchador(instancia);
        // Debe devolver algo aunque falten stats
        expect(luch).not.toBeNull();
    });

    it('esInmuneAEstado maneja personaje undefined', function() {
        expect(sistema.esInmuneAEstado(undefined, 'congelado')).toBeFalse();
        expect(sistema.esInmuneAEstado(null, 'congelado')).toBeFalse();
    });

    it('tieneEstado maneja personaje sin array estados', function() {
        const p = { estado: 'activo' }; // Sin array estados
        expect(sistema.tieneEstado(p, 'congelado')).toBeFalse();
    });

    it('puedeActuar maneja personaje undefined', function() {
        expect(sistema.puedeActuar(undefined)).toBeFalse();
        expect(sistema.puedeActuar(null)).toBeFalse();
    });

    it('calcularVelocidadEquipo maneja personajes sin velocidad', function() {
        const equipo = [{ nombre: 'A' }, { velocidad: 60 }, { nombre: 'C' }];
        // Debe usar valor por defecto 50 para los que no tienen velocidad
        expect(sistema.calcularVelocidadEquipo(equipo)).toEqual(160); // 50 + 60 + 50
    });

    it('calcularStatsConEquipamientoYSinergia maneja equipo null', function() {
        const statsBase = { ataque: 100, defensa: 50, vida: 500 };
        const res = sistema.calcularStatsConEquipamientoYSinergia(statsBase, null, 'Fuego');
        expect(res.ataque).toEqual(100);
        expect(res.defensa).toEqual(50);
        expect(res.vida).toEqual(500);
    });

    it('invocarGacha descuenta exactamente el costo correcto', function() {
        const usuario = { email: 'cost@test.com', monedas: 1000, inventario: [], equipamiento: [] };
        sistema.agregarUsuario(usuario);
        sistema.usuarios[usuario.email] = usuario;
        const monedasAntes = usuario.monedas;
        sistema.invocarGacha(usuario);
        expect(usuario.monedas).toEqual(monedasAntes - data.Costos.invocacionSimple);
    });

    it('invocarGachaMultiple descuenta exactamente el costo correcto', function() {
        const usuario = { email: 'cost10@test.com', monedas: 10000, inventario: [], equipamiento: [] };
        sistema.agregarUsuario(usuario);
        sistema.usuarios[usuario.email] = usuario;
        const monedasAntes = usuario.monedas;
        sistema.invocarGachaMultiple(usuario);
        expect(usuario.monedas).toEqual(monedasAntes - data.Costos.invocacionMultiple);
    });
});

// ==================== PRUEBAS DE CÁLCULOS Y FÓRMULAS ====================
describe('Pruebas de fórmulas y cálculos correctos', function() {
    let sistema;
    
    beforeEach(function() {
        sistema = new modelo.Sistema(true);
    });

    it('defensa reduce el daño correctamente (50% de defensa)', function() {
        const objetivo = { nombre: 'Tank', vida: 1000, vidaActual: 1000, defensa: 100, escudo: 0, estado: 'activo', mana: 0, manaMax: 4, estados: [] };
        // Fórmula: danioReducido = defensa * 0.5 = 50
        // danioReal = max(0, danio - 50)
        let res = sistema.aplicarDanio(objetivo, 100);
        expect(res.danioReducidoDefensa).toEqual(50); // 100 * 0.5
        expect(res.danioReal).toEqual(50); // 100 - 50
        expect(objetivo.vidaActual).toEqual(950);
    });

    it('escudo absorbe daño antes de afectar vida', function() {
        const objetivo = { nombre: 'Escudo', vida: 100, vidaActual: 100, defensa: 0, escudo: 30, estado: 'activo', mana: 0, manaMax: 4, estados: [] };
        let res = sistema.aplicarDanio(objetivo, 50);
        expect(res.escudoAbsorbido).toEqual(30);
        expect(res.danioReal).toEqual(20); // 50 - 30 absorbido por escudo
        expect(objetivo.vidaActual).toEqual(80);
        expect(objetivo.escudo).toEqual(0);
    });

    it('sinergia elemental duplica stats de equipamiento', function() {
        const statsBase = { ataque: 100, defensa: 50, vida: 500 };
        const equipo = {
            arma: { stats: { ataque: 50, defensa: 0, vida: 0, tipoBonoAtaque: 'plano' }, elemento: 'Fuego' },
            casco: null, pechera: null, pantalones: null, zapatos: null
        };
        // Con sinergia (Fuego + Fuego): ataque = 50 * 2 = 100
        const resFuego = sistema.calcularStatsConEquipamientoYSinergia(statsBase, equipo, 'Fuego');
        expect(resFuego.ataque).toEqual(200); // 100 base + 100 (50*2 sinergia)
        
        // Sin sinergia (Fuego + Agua): ataque = 50 * 1 = 50
        const resAgua = sistema.calcularStatsConEquipamientoYSinergia(statsBase, equipo, 'Agua');
        expect(resAgua.ataque).toEqual(150); // 100 base + 50
    });

    it('maná se incrementa al recibir daño (máximo 4)', function() {
        const objetivo = { nombre: 'Mana', vida: 100, vidaActual: 100, defensa: 0, escudo: 0, estado: 'activo', mana: 3, manaMax: 4, estados: [] };
        sistema.aplicarDanio(objetivo, 10);
        expect(objetivo.mana).toEqual(4); // 3 + 1, tope en 4
        
        // Si ya tiene 4, no sube más
        sistema.aplicarDanio(objetivo, 10);
        expect(objetivo.mana).toEqual(4);
    });

    it('aplicarDanioDirecto ignora defensa completamente', function() {
        const objetivo = { nombre: 'NoDefensa', vida: 100, vidaActual: 100, defensa: 999, estado: 'activo', mana: 0, manaMax: 4, estados: [] };
        let res = sistema.aplicarDanioDirecto(objetivo, 30);
        expect(res.danioReal).toEqual(30);
        expect(objetivo.vidaActual).toEqual(70);
    });
});

console.log('Archivo de pruebas modeloSpec.js cargado correctamente.');
