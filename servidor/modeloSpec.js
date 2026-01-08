const modelo = require("./modelo.js");

xdescribe('El sistema', function() {
 let sistema;
 beforeEach(function() {
 sistema=new modelo.Sistema()
 });
       it('inicialmente no hay usuarios', function() {
              expect(sistema.numeroUsuarios().num).toEqual(0);       });
       it('se puede agregar un usuario', function() {
              sistema.agregarUsuario('pepe');
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
       it ('se puede comprobar si un usuario existe', function() {
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
})

describe("Pruebas de las partidas",function(){
       let sistema;
       let usr2;
       let usr3;
       beforeEach(function(){
              sistema=new modelo.Sistema();
              usr2={"nick":"Pepa","email":"pepa@pepa.es"};
              usr3={"nick":"Pepo","email":"pepo@pepo.es"};
              sistema.agregarUsuario("Pepe");
              sistema.agregarUsuario(usr2.nick);
              sistema.agregarUsuario(usr3.nick);
       });

       it("Usuarios y partidas en el sistema",function(){
              expect(sistema.numeroUsuarios().num).toEqual(3);
              expect(sistema.obtenerPartidasDisponibles().length).toEqual(0);
       });

       it("Crear partida",function(){
              let codigo = sistema.crearPartida("Pepe");
              expect(codigo).toBeDefined();
              expect(sistema.partidas[codigo]).toBeDefined();
              expect(sistema.partidas[codigo].jugadores.length).toEqual(1);
              expect(sistema.partidas[codigo].jugadores[0].nick).toEqual("Pepe");
       });

       it("Unir a partida",function(){
              let codigo = sistema.crearPartida("Pepe");
              sistema.unirAPartida(usr2.nick, codigo);
              expect(sistema.partidas[codigo].jugadores.length).toEqual(2);
              expect(sistema.partidas[codigo].jugadores[1].nick).toEqual(usr2.nick);
       });

       it("Un usuario no puede estar dos veces",function(){
              let codigo = sistema.crearPartida("Pepe");
              sistema.unirAPartida("Pepe", codigo);
              expect(sistema.partidas[codigo].jugadores.length).toEqual(1);
       });

       it("Obtener partidas",function(){
              let codigo = sistema.crearPartida("Pepe");
              let lista = sistema.obtenerPartidasDisponibles();
              expect(lista.length).toEqual(1);
              expect(lista[0].codigo).toEqual(codigo);
              
              sistema.unirAPartida(usr2.nick, codigo);
              lista = sistema.obtenerPartidasDisponibles();
              expect(lista.length).toEqual(0);
       });
});