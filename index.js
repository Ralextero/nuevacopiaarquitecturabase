require('dotenv').config();
const fs = require("fs");
const express = require('express');
const bodyParser=require("body-parser");
const app = express();
const httpServer = require('http').Server(app);
const { Server } = require("socket.io");

// Stripe para pagos
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const passport=require("passport");
const cookieSession=require("cookie-session");
const LocalStrategy = require('passport-local').Strategy;
require("./servidor/passport-setup.js");
const modelo = require("./servidor/modelo.js");
const data = require("./servidor/data.js");
const moduloWS = require("./servidor/servidorWS.js");
let sistema = new modelo.Sistema();
let ws = new moduloWS.ServidorWS();
let io = new Server(httpServer);

const PORT = process.env.PORT || 3000;
app.use(express.static(__dirname + "/"));
app.use(bodyParser.urlencoded({extended:true}));
app.use(bodyParser.json());

// Helper: buscar usuario por email O por nick personalizado
function buscarUsuario(nickOrEmail) {
    // Primero intentar por email (clave primaria)
    let usuario = sistema.usuarios[nickOrEmail];
    if (usuario) return usuario;
    
    // Si no, buscar por nick personalizado
    for (let email in sistema.usuarios) {
        let u = sistema.usuarios[email];
        if (u.nickPersonalizado === nickOrEmail || u.nick === nickOrEmail) {
            return u;
        }
    }
    return null;
}

app.use(cookieSession({
    name: 'Sistema',
    keys: ['key1', 'key2']
}));
app.use(passport.initialize());
app.use(passport.session());
// Estrategia local de Passport (después de inicializar sesión)
passport.use(
    new LocalStrategy(
        { usernameField: "email", passwordField: "password" },
        function (email, password, done) {
            sistema.loginUsuario({ email: email, password: password }, function (user) {
                if (!user || user.email === -1){
                    return done(null, false);
                }
                if (!sistema.usuarioActivo(user.email).res){
                    sistema.agregarUsuario(user);
                }
                return done(null, user);
            });
        }
    )
);
app.get("/auth/google",passport.authenticate('google', { scope: ['profile','email'], prompt: 'select_account' }));
app.get('/google/callback',
 passport.authenticate('google', { failureRedirect: '/fallo' }),
 function(req, res) {
 res.redirect('/good');
});
// Ruta para One Tap, según práctica
app.post('/oneTap/callback',
 passport.authenticate('google-one-tap', { failureRedirect: '/fallo' }),
 function(req, res) {
     res.redirect('/good');
 }
);
app.get("/good", function(request,response){
 let email=request.user.emails[0].value;
 sistema.usuarioGoogle({"email":email},function(obj){
 // Guardar AMBAS cookies: email (identificador real) y nick (display)
 response.cookie('email', obj.email);
 response.cookie('nick', obj.email);
 // Marcar usuario activo también para flujo Google / One Tap
 if (!sistema.usuarioActivo(obj.email).res){
     sistema.agregarUsuario(obj);
 }
 response.redirect('/');
});
});
app.get("/fallo",function(request,response){
 // Unificar semántica de fallo: nick:-1 y status 401
 response.status(401).json({nick:-1,error:"Credenciales inválidas, cuenta no confirmada o error en autenticación."});
});

// Endpoint para registrar usuarios locales
app.post('/registrarUsuario', function(request, response){
    sistema.registrarUsuario(request.body, function(res){
        // éxito -> {nick: email}; duplicado -> {nick:-1}
        if (res && res.email && res.email!==-1){
            response.send({ "nick": res.email });
        }
        else{
            response.send({ "nick": -1 });
        }
    });
});


// Servir index.html en la ruta raíz
app.get("/", function(req, res) {
    res.sendFile(__dirname + "/cliente/index.html");
});

app.get("/agregarUsuario/:nick", function(request, response) {
    let nick = request.params.nick;
    // Recuperar usuario de la BD para mantener persistencia (inventario, monedas)
    sistema.usuarioGoogle({email: nick}, function(usuario) {
        let res = sistema.agregarUsuario(usuario);
        // Devolver también inventario y monedas para sincronizar cliente
        if (sistema.usuarios[nick]) {
            res.monedas = sistema.usuarios[nick].monedas;
            res.inventario = sistema.usuarios[nick].inventario;
        }
        response.send(res);
    });
});

// Endpoint para reconectar usuario existente (al recargar página)
app.get("/reconectarUsuario/:email", function(request, response) {
    let email = request.params.email;
    
    // Buscar usuario en BD y cargarlo en memoria
    sistema.usuarioGoogle({email: email}, function(usuario) {
        if (usuario && usuario.email) {
            // Agregar a usuarios activos
            let res = sistema.agregarUsuario(usuario);
            
            // Obtener perfil para nick personalizado
            sistema.cad.obtenerPerfil(email, function(perfil) {
                // Guardar nickPersonalizado en el objeto Usuario en memoria
                if (sistema.usuarios[email] && perfil && perfil.nickPersonalizado) {
                    sistema.usuarios[email].nickPersonalizado = perfil.nickPersonalizado;
                }
                
                response.send({
                    email: email,
                    nick: (perfil && perfil.nickPersonalizado) ? perfil.nickPersonalizado : email.split('@')[0],
                    monedas: usuario.monedas ?? sistema.usuarios[email]?.monedas ?? 1000,
                    avatar: (perfil && perfil.avatar) ? perfil.avatar : '/cliente/img/perfilPorDefecto.png'
                });
            });
        } else {
            response.send({ error: "Usuario no encontrado" });
        }
    });
});

// Endpoint para obtener la lista de usuarios
app.get("/obtenerUsuarios", function(request, response) {
    let usuarios = sistema.obtenerUsuarios();
    response.send(usuarios);
});

// Endpoint para comprobar si un usuario está activo
app.get("/usuarioActivo/:nick", function(request, response) {
    let nick = request.params.nick;
    let activo = sistema.usuarioActivo(nick);
    response.send(activo);
});

app.get("/numeroUsuarios", function(request, response) {
    let numero = sistema.numeroUsuarios();
    response.send(numero);
});

app.get("/eliminarUsuario/:nick", function(request, response) {
    let nick = request.params.nick;
    let existia = sistema.usuarioActivo(nick).res;
    if (existia) {
        sistema.eliminarUsuario(nick);
        response.send(true);
    } else {
        response.send(false);
    }
});

app.get("/invocarGacha/:nick", function(request, response) {
    let nick = request.params.nick;
    let usuario = buscarUsuario(nick);
    
    if (usuario) {
        let resultado = sistema.invocarGacha(usuario);
        if (resultado) {
            resultado.monedasRestantes = usuario.monedas;
            response.send(resultado);
        } else {
            response.send({error: "No tienes suficiente dinero", monedasActuales: usuario.monedas});
        }
    } else {
        console.log("GACHA x1 - Usuario no encontrado:", nick, "| Usuarios:", Object.keys(sistema.usuarios));
        response.send({error: "Usuario no encontrado"});
    }
});

// BACKDOOR ADMIN
app.get("/admin/inject/:email/:nombrePersonaje/:cantidad", function(request, response) {
    let email = request.params.email; // Puede ser nick si buscarUsuario lo soporta
    let nombre = request.params.nombrePersonaje;
    let cantidad = request.params.cantidad;

    let usuario = buscarUsuario(email);
    if (usuario) {
        let resAdmin = sistema.injectarPersonaje(usuario, nombre, cantidad);
        response.send(resAdmin);
    } else {
        response.send({ error: "Usuario no encontrado" });
    }
});

// Endpoint para añadir monedas (testing/debug)
app.get("/addMonedas/:nick/:cantidad", function(request, response) {
    let nick = request.params.nick;
    let cantidad = parseInt(request.params.cantidad) || 1000;
    let usuario = buscarUsuario(nick);
    if (usuario) {
        usuario.monedas += cantidad;
        // Guardar en BD
        if (sistema.cad.actualizarMonedas) {
            sistema.cad.actualizarMonedas(usuario, function(res) {
                console.log("Monedas añadidas y guardadas");
            });
        }
        response.send({ ok: true, monedas: usuario.monedas });
    } else {
        response.send({ error: "Usuario no encontrado" });
    }
});

// Endpoint para añadir XP masiva a todos los personajes (testing/debug)
app.get("/addXPMasiva/:nick/:cantidad", function(request, response) {
    let nick = request.params.nick;
    let cantidad = parseInt(request.params.cantidad) || 500000000000000; // 500T por defecto
    let usuario = buscarUsuario(nick);
    if (usuario) {
        if (!usuario.inventario || usuario.inventario.length === 0) {
            return response.send({ error: "No tienes personajes" });
        }
        
        let resultados = [];
        let equipoUIDs = usuario.inventario.map(inst => inst.uid);
        
        // Aplicar XP a todos los personajes
        let xpResultados = sistema.aplicarXPEquipo(usuario, equipoUIDs, cantidad);
        
        // Guardar en BD
        if (sistema.cad.actualizarInventario) {
            sistema.cad.actualizarInventario(usuario, function(res) {
                console.log("XP masiva aplicada y guardada");
            });
        }
        
        response.send({ ok: true, resultados: xpResultados, cantidad: cantidad });
    } else {
        response.send({ error: "Usuario no encontrado" });
    }
});

// Endpoint para guardar perfil (nick y avatar)
app.post("/guardarPerfil", function(request, response) {
    let email = request.body.email;
    let nickPersonalizado = request.body.nick;
    let avatar = request.body.avatar;
    
    if (!email) {
        return response.send({ error: "Email requerido" });
    }
    
    sistema.cad.actualizarPerfil(email, nickPersonalizado, avatar, function(res) {
        if (res.error) {
            response.send({ error: res.error });
        } else {
            // También actualizar en memoria si el usuario está activo
            if (sistema.usuarios[email]) {
                sistema.usuarios[email].nickPersonalizado = nickPersonalizado;
                sistema.usuarios[email].avatar = avatar;
            }
            response.send({ ok: true, nick: nickPersonalizado, avatar: avatar });
        }
    });
});

// Endpoint para obtener perfil
app.get("/obtenerPerfil/:email", function(request, response) {
    let email = request.params.email;
    
    sistema.cad.obtenerPerfil(email, function(res) {
        if (res.error) {
            response.send({ error: res.error });
        } else {
            response.send({
                nick: res.nickPersonalizado || email.split('@')[0],
                avatar: res.avatar || '/cliente/img/perfilPorDefecto.png',
                monedas: res.monedas || 0
            });
        }
    });
});

// Endpoint para invocación múltiple (x10)
app.get("/invocarGachaMultiple/:nick", function(request, response) {
    let nick = request.params.nick;
    let usuario = buscarUsuario(nick);
    if (usuario) {
        let resultados = sistema.invocarGachaMultiple(usuario);
        if (resultados) {
            response.send({
                resultados: resultados,
                monedasRestantes: usuario.monedas
            });
        } else {
            response.send({error: "No tienes suficientes monedas (necesitas 900)", monedasActuales: usuario.monedas});
        }
    } else {
        response.send({error: "Usuario no encontrado"});
    }
});

// Endpoint para invocación masiva (x100)
app.get("/invocarGachaCien/:nick", function(request, response) {
    let nick = request.params.nick;
    let usuario = buscarUsuario(nick);
    if (usuario) {
        let resultados = sistema.invocarGachaCien(usuario);
        if (resultados) {
            response.send({
                resultados: resultados,
                monedasRestantes: usuario.monedas
            });
        } else {
            response.send({error: "No tienes suficientes monedas (necesitas 8000)", monedasActuales: usuario.monedas});
        }
    } else {
        response.send({error: "Usuario no encontrado"});
    }
});

// ==============================================================================
// ==================== ENDPOINTS DE EQUIPAMIENTO ====================
// ==============================================================================

// Invocar equipamiento (x1, x10, x100)
app.get("/invocarEquipamiento/:nick/:cantidad", function(request, response) {
    let nick = request.params.nick;
    let cantidad = parseInt(request.params.cantidad) || 1;
    let usuario = buscarUsuario(nick);
    
    if (usuario) {
        let resultados = sistema.invocarEquipamiento(usuario, cantidad);
        if (resultados && resultados.errorInventario) {
            // Error de inventario lleno
            response.send({
                error: resultados.mensaje,
                errorInventario: true,
                espacioDisponible: resultados.espacioDisponible,
                cantidadRequerida: resultados.cantidadRequerida
            });
        } else if (resultados) {
            response.send({
                items: resultados,
                monedasRestantes: usuario.monedas
            });
        } else {
            let costoRequerido = cantidad === 100 ? 16000 : (cantidad === 10 ? 1800 : 200);
            response.send({
                error: `No tienes suficientes monedas (necesitas ${costoRequerido})`,
                monedasActuales: usuario.monedas
            });
        }
    } else {
        response.send({error: "Usuario no encontrado"});
    }
});

// Obtener equipamiento del usuario
app.get("/obtenerEquipamiento/:nick", function(request, response) {
    let nick = request.params.nick;
    let usuario = buscarUsuario(nick);
    
    if (usuario) {
        let equipamiento = sistema.obtenerEquipamiento(usuario);
        response.send({ equipamiento: equipamiento });
    } else {
        response.send({error: "Usuario no encontrado"});
    }
});

// Equipar ítem a personaje
app.post("/equiparItem", function(request, response) {
    let { nick, itemId, personajeUid } = request.body;
    let usuario = buscarUsuario(nick);
    
    if (usuario) {
        let resultado = sistema.equiparItem(usuario, itemId, personajeUid);
        response.send(resultado);
    } else {
        response.send({error: true, mensaje: "Usuario no encontrado"});
    }
});

// Desequipar ítem
app.post("/desequiparItem", function(request, response) {
    let { nick, itemId } = request.body;
    let usuario = buscarUsuario(nick);
    
    if (usuario) {
        let resultado = sistema.desequiparItem(usuario, itemId);
        response.send(resultado);
    } else {
        response.send({error: true, mensaje: "Usuario no encontrado"});
    }
});

// Eliminar ítem de equipamiento (vender)
app.post("/eliminarEquipamiento", function(request, response) {
    let { nick, itemId } = request.body;
    let usuario = buscarUsuario(nick);
    
    if (usuario) {
        let resultado = sistema.eliminarEquipamiento(usuario, itemId);
        response.send(resultado);
    } else {
        response.send({error: true, mensaje: "Usuario no encontrado"});
    }
});

// Obtener información del inventario de equipamiento
app.get("/infoInventarioEquipamiento/:nick", function(request, response) {
    let nick = request.params.nick;
    let usuario = buscarUsuario(nick);
    
    if (usuario) {
        let info = sistema.obtenerInfoInventarioEquipamiento(usuario);
        response.send(info);
    } else {
        response.send({error: "Usuario no encontrado"});
    }
});

// ==============================================================================

app.get("/obtenerInventario/:nick", function(request, response) {
    let nick = request.params.nick;
    let usuario = buscarUsuario(nick);
    if (usuario) {
        let lista = sistema.obtenerInventario(usuario);
        // Incluir también el poder del usuario y el equipamiento
        let poderUsuario = sistema.calcularPoderUsuario(usuario);
        let equipamiento = sistema.obtenerEquipamiento(usuario);
        let infoInventarioEquip = sistema.obtenerInfoInventarioEquipamiento(usuario);
        response.send({
            inventario: lista,
            equipamiento: equipamiento,
            poderUsuario: poderUsuario.poderTotal,
            top3: poderUsuario.top3,
            infoEquipamiento: infoInventarioEquip
        });
    } else {
        response.send({error: "Usuario no encontrado"});
    }
});

// Endpoint para evolucionar un personaje
app.get("/evolucionarPersonaje/:nick/:uid", function(request, response) {
    let nick = request.params.nick;
    let uid = request.params.uid;
    let usuario = buscarUsuario(nick);
    if (usuario) {
        let resultado = sistema.evolucionarPersonaje(usuario, uid);
        response.send(resultado);
    } else {
        response.send({exito: false, mensaje: "Usuario no encontrado"});
    }
});

// Endpoint para evolucionar todos los personajes al máximo
app.get("/evolucionarTodosAlMaximo/:nick", function(request, response) {
    let nick = request.params.nick;
    let usuario = buscarUsuario(nick);
    if (usuario) {
        let resultado = sistema.evolucionarTodosAlMaximo(usuario);
        response.send(resultado);
    } else {
        response.send({exito: false, mensaje: "Usuario no encontrado"});
    }
});

httpServer.listen(PORT, () => {
    console.log(`App está escuchando en el puerto ${PORT}`);
    console.log('Ctrl+C para salir');
});
//io.listen(httpServer);
ws.lanzarServidor(io, sistema);

// (Eliminada segunda definición duplicada de /registrarUsuario para evitar sobrescribir la lógica de duplicados)

// Endpoint de inicio de sesión local (respuesta JSON directa para AJAX)
app.post('/loginUsuario', function(request, response, next) {
    passport.authenticate("local", function(err, user, info) {
        if (err) {
            return response.status(500).json({ nick: -1, error: "Error interno" });
        }
        if (!user) {
            return response.status(401).json({ nick: -1, error: "Credenciales incorrectas" });
        }
        request.logIn(user, function(err) {
            if (err) {
                return response.status(500).json({ nick: -1, error: "Error de sesión" });
            }
            if (!sistema.usuarioActivo(user.email).res) {
                sistema.agregarUsuario(user.email);
            }
            // Devolver nick Y email para que el cliente pueda guardar ambos
            return response.json({ nick: user.email, email: user.email });
        });
    })(request, response, next);
});

app.get("/confirmarUsuario/:email/:key",function(request,response){
let email=request.params.email;
let key=request.params.key;
sistema.confirmarUsuario({"email":email,"key":key},function(usr){
if (usr.email!=-1){
response.cookie('nick',usr.email);
}
response.redirect('/');
});
})

const haIniciado=function(request,response,next){
if (request.user){
next();
}
else{
response.redirect("/")
}
}

app.get("/obtenerUsuarios",haIniciado,function(request,response){
let lista=sistema.obtenerUsuarios();
response.send(lista);
});

app.get("/cerrarSesion",haIniciado,function(request,response){
    // En estrategias locales el objeto tiene email, no nick
    const nick = (request.user && (request.user.nick || request.user.email)) ? (request.user.nick || request.user.email) : undefined;
    // Passport 0.6 logout asíncrono
    request.logout(function(err){
        if (err){ console.log("Error al cerrar sesión:",err); }
        if (nick){
            sistema.eliminarUsuario(nick);
        }
        response.redirect("/");
    });
});

// ==================== STRIPE PAYMENTS ====================

// Packs de monedas disponibles (precios en céntimos de EUR)
const PACKS_MONEDAS = {
    'iniciado': { monedas: 500, precio: 299, nombre: 'Pack Iniciado' },      // 2.99€
    'guerrero': { monedas: 1500, precio: 699, nombre: 'Pack Guerrero' },     // 6.99€
    'leyenda': { monedas: 5000, precio: 1999, nombre: 'Pack Leyenda' },      // 19.99€
    'magnate': { monedas: 10000000, precio: 99999999, nombre: 'Pack Magnate' } // 999,999.99€ (cantidad cobrada a Stripe)
};

// Obtener clave pública de Stripe (para el frontend)
app.get("/stripe-config", function(request, response) {
    response.json({
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY
    });
});

// Crear Payment Intent
app.post("/create-payment-intent", async function(request, response) {
    try {
        const { packId, email } = request.body;
        
        // Validar pack
        const pack = PACKS_MONEDAS[packId];
        if (!pack) {
            return response.status(400).json({ error: 'Pack no válido' });
        }
        
        // Crear Payment Intent en Stripe
        const paymentIntent = await stripe.paymentIntents.create({
            amount: pack.precio, // En céntimos
            currency: 'eur',
            metadata: {
                packId: packId,
                monedas: pack.monedas,
                email: email
            },
            description: `${pack.nombre} - ${pack.monedas} monedas para ${email}`
        });
        
        response.json({
            clientSecret: paymentIntent.client_secret,
            pack: pack
        });
    } catch (error) {
        console.error('Error creando Payment Intent:', error);
        response.status(500).json({ error: 'Error procesando el pago' });
    }
});

// Confirmar pago y añadir monedas
app.post("/confirm-payment", async function(request, response) {
    try {
        const { paymentIntentId, email } = request.body;
        
        // Verificar el pago con Stripe
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        
        if (paymentIntent.status === 'succeeded') {
            const monedas = parseInt(paymentIntent.metadata.monedas);
            const userEmail = paymentIntent.metadata.email;
            
            // Añadir monedas al usuario
            if (sistema.usuarios[userEmail]) {
                sistema.usuarios[userEmail].monedas += monedas;
                // Guardar en BD
                sistema.cad.actualizarInventario(sistema.usuarios[userEmail], function(res) {
                    console.log(`Pago confirmado: ${monedas} monedas añadidas a ${userEmail}`);
                });
            }
            
            response.json({ 
                success: true, 
                monedas: monedas,
                nuevoTotal: sistema.usuarios[userEmail]?.monedas || monedas
            });
        } else {
            response.status(400).json({ error: 'El pago no fue completado' });
        }
    } catch (error) {
        console.error('Error confirmando pago:', error);
        response.status(500).json({ error: 'Error confirmando el pago' });
    }
});
