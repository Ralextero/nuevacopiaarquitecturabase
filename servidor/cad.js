function CAD(){
const mongo=require("mongodb").MongoClient;
const ObjectId=require("mongodb").ObjectId;
this.usuarios = null; // Inicializado explícitamente como null
this._conectado = false; // Flag para saber si estamos conectados

// Método helper para verificar que CAD está conectado
this._verificarConexion = function() {
    if (!this.usuarios) {
        console.warn('[CAD] Advertencia: CAD no está conectado a MongoDB. Operación ignorada.');
        return false;
    }
    return true;
};

this.conectar=async function(callback){
let cad=this;
let uri = process.env.MONGO_URI
let client= new mongo(uri);
await client.connect();
const database=client.db("sistema");
cad.usuarios=database.collection("usuarios");
cad._conectado = true;
 // Índice único por email para prevenir duplicados
 try { 
    cad.usuarios.createIndex({ email: 1 }, { unique: true }); 
 } catch (e) {
    console.warn('[CAD] No se pudo crear índice único por email:', e.message);
 }
callback(database);
}

this.buscarOCrearUsuario=function(usr,callback){
    // Verificar conexión antes de operar
    if (!this._verificarConexion()) {
        if (callback) callback(usr); // Devolver el usuario tal cual en modo test/sin conexión
        return;
    }
    buscarOCrear(this.usuarios,usr,callback);
}
function buscarOCrear(coleccion,criterio,callback)
{
coleccion.findOneAndUpdate(
    criterio, 
    {
        $set: criterio,
        $setOnInsert: { monedas: 1000, inventario: [], equipamiento: [] } // Valores por defecto al crear usuario nuevo
    }, 
    {
        upsert: true,
        returnDocument: "after",
        projection: {_id:1, email:1, inventario:1, monedas:1, equipamiento:1}
    }, 
    function(err,doc) {
        if (err) { 
            console.error("Error en buscarOCrear:", err);
            throw err; 
        }
        else {
            // Compatibilidad con diferentes versiones del driver MongoDB
            let resultado = doc.value || doc;
            console.log("Elemento actualizado:", resultado.email, "Monedas:", resultado.monedas);
            
            // Si las monedas son 0 o undefined, corregir a 1000 (para cuentas antiguas)
            let monedasFinales = resultado.monedas;
            if (monedasFinales === 0 || monedasFinales === undefined || monedasFinales === null) {
                monedasFinales = 1000;
                // Actualizar en BD también
                coleccion.updateOne(criterio, { $set: { monedas: 1000 } });
                console.log("Corregidas monedas a 1000 para:", resultado.email);
            }
            
            callback({
                _id: resultado._id,
                email: resultado.email,
                inventario: resultado.inventario || [],
                equipamiento: resultado.equipamiento || [],
                monedas: monedasFinales
            });
        }
    }
);
}

	// Métodos públicos para registro/consulta de usuarios locales
	this.buscarUsuario=function(obj,callback){
		// Verificar conexión antes de operar
		if (!this._verificarConexion()) {
			if (callback) callback(undefined); // No encontrado en modo test
			return;
		}
		buscar(this.usuarios,obj,callback);
	}

	this.insertarUsuario=function(usuario,callback){
		// Verificar conexión antes de operar
		if (!this._verificarConexion()) {
			if (callback) callback(usuario); // Devolver usuario en modo test
			return;
		}
		insertar(this.usuarios,usuario,callback);
	}

    this.actualizarInventario = function(usuario, callback) {
        // Verificar conexión antes de operar
        if (!this._verificarConexion()) {
            if (callback) callback(usuario); // Callback con usuario en modo test
            return;
        }
        actualizarInventario(this.usuarios, usuario, callback);
    }

    function actualizarInventario(coleccion, usuario, callback) {
        coleccion.findOneAndUpdate(
            { email: usuario.email },
            { $set: { inventario: usuario.inventario, monedas: usuario.monedas, equipamiento: usuario.equipamiento || [] } },
            { upsert: false, returnDocument: "after", projection: { email: 1, inventario: 1, monedas: 1, equipamiento: 1 } },
            function(err, doc) {
                if (err) { throw err; }
                else {
                    console.log("Inventario y equipamiento actualizado");
                    // Normalizar respuesta para diferentes versiones del driver MongoDB
                    let resultado = doc && doc.value ? doc.value : doc;
                    if (resultado) {
                        callback({ email: resultado.email, inventario: resultado.inventario, monedas: resultado.monedas, equipamiento: resultado.equipamiento });
                    } else {
                        console.warn('[CAD] actualizarInventario: respuesta inesperada de MongoDB');
                        callback(usuario); // Devolver usuario original como fallback
                    }
                }
            }
        );
    }

    this.actualizarMonedas = function(usuario, callback) {
        // Verificar conexión antes de operar
        if (!this._verificarConexion()) {
            if (callback) callback(usuario);
            return;
        }
        actualizarMonedas(this.usuarios, usuario, callback);
    }

    function actualizarMonedas(coleccion, usuario, callback) {
        coleccion.findOneAndUpdate(
            { email: usuario.email },
            { $set: { monedas: usuario.monedas } },
            { upsert: false, returnDocument: "after", projection: { email: 1, monedas: 1 } },
            function(err, doc) {
                if (err) { throw err; }
                else {
                    console.log("Monedas actualizadas");
                    // Normalizar respuesta para diferentes versiones del driver MongoDB
                    let resultado = doc && doc.value ? doc.value : doc;
                    if (callback && resultado) {
                        callback({ email: resultado.email, monedas: resultado.monedas });
                    } else if (callback) {
                        callback(usuario); // Fallback
                    }
                }
            }
        );
    }

    // Actualizar perfil del usuario (nick personalizado y avatar)
    this.actualizarPerfil = function(email, nickPersonalizado, avatar, callback) {
        // Solo actualizar los campos que tienen valor
        let updateFields = {};
        if (nickPersonalizado !== undefined && nickPersonalizado !== null) {
            updateFields.nickPersonalizado = nickPersonalizado;
        }
        if (avatar !== undefined && avatar !== null) {
            updateFields.avatar = avatar;
        }
        
        if (Object.keys(updateFields).length === 0) {
            if (callback) callback({ error: "No hay campos para actualizar" });
            return;
        }
        
        this.usuarios.findOneAndUpdate(
            { email: email },
            { $set: updateFields },
            { upsert: false, returnDocument: "after", projection: { email: 1, nickPersonalizado: 1, avatar: 1 } },
            function(err, doc) {
                if (err) { 
                    console.error("Error actualizando perfil:", err);
                    if (callback) callback({ error: "Error actualizando perfil" });
                } else if (doc && doc.value) {
                    console.log("Perfil actualizado:", doc.value.email, "campos:", Object.keys(updateFields));
                    if (callback) callback({ 
                        email: doc.value.email, 
                        nickPersonalizado: doc.value.nickPersonalizado, 
                        avatar: doc.value.avatar 
                    });
                } else {
                    if (callback) callback({ error: "Usuario no encontrado" });
                }
            }
        );
    }

    // Obtener perfil del usuario
    this.obtenerPerfil = function(email, callback) {
        this.usuarios.findOne(
            { email: email },
            { projection: { email: 1, nickPersonalizado: 1, avatar: 1, monedas: 1, inventario: 1 } },
            function(err, doc) {
                if (err) {
                    console.error("Error obteniendo perfil:", err);
                    if (callback) callback({ error: "Error obteniendo perfil" });
                } else if (doc) {
                    if (callback) callback(doc);
                } else {
                    if (callback) callback({ error: "Usuario no encontrado" });
                }
            }
        );
    }

	// Métodos "privados"
	function buscar(coleccion,criterio,callback){
		coleccion.find(criterio).toArray(function(error,usuarios){
			if (usuarios.length==0){
				callback(undefined);
			}
			else{
				callback(usuarios[0]);
			}
		});
	}

	function insertar(coleccion,elemento,callback){
		coleccion.insertOne(elemento,function(err,result){
			if(err){
				console.log("error");
			}
			else{
				console.log("Nuevo elemento creado");
				callback(elemento);
			}
		});
	}

	this.actualizarUsuario=function(obj,callback){
		// Verificar conexión antes de operar
		if (!this._verificarConexion()) {
			if (callback) callback(obj); // Devolver objeto en modo test
			return;
		}
		actualizar(this.usuarios,obj,callback);
	}

	function actualizar(coleccion,obj,callback){
			coleccion.findOneAndUpdate({_id:ObjectId(obj._id)}, {$set: obj},
		{upsert: false,returnDocument:"after",projection:{email:1}},
		function(err,doc) {
			if (err) { throw err; }
			else {
				console.log("Elemento actualizado");
				// Validar que se haya encontrado y actualizado el documento
				if (doc && doc.value) {
					callback({email:doc.value.email});
				} else {
					console.log(`No se encontró el documento con _id: ${obj._id}`);
					callback({email: null});
				}
			}
		});
	}
}
module.exports.CAD=CAD;