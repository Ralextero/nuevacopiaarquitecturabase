function ClienteRest() {
	this.agregarUsuario = function(nick) {
		var cli = this;
		$.getJSON("/agregarUsuario/" + nick, function(data) {
			let msg ="El nick " + nick + " está ocupado.";
			if (data.nick != -1) {
				console.log("Usuario " + nick + " ha sido registrado");
				msg ="Bienvenido al sistema, " + nick;
				ws.email = data.email || nick;
				ws.nick = nick;
				// Guardar ambas cookies para persistencia
				$.cookie("nick", ws.nick, { expires: 365, path: '/' });
				$.cookie("email", ws.email, { expires: 365, path: '/' });
                cw.mostrarHome();
			} else {
				console.log("El nick ya está ocupado");
			}
			cw.mostrarMensaje(msg);
		});
	}

	this.agregarUsuario2 = function(nick, callback) {
		$.ajax({
			type: 'GET',
			url: '/agregarUsuario/' + nick,
			success: function(data) {
				if (data.nick != -1) {
					console.log("Usuario " + nick + " ha sido registrado");
					ws.monedas = data.monedas || 1000;
				} else {
					console.log("El nick ya está ocupado");
				}
				if (callback) callback(data);
			},
			error: function(xhr, textStatus, errorThrown) {
				console.log("Status: " + textStatus);
				console.log("Error: " + errorThrown);
				if (callback) callback(null);
			},
			contentType: 'application/json'
		});
	}

	// Reconectar usuario existente usando email (para recargas de página)
	this.reconectarUsuario = function(email, callback) {
		$.ajax({
			type: 'GET',
			url: '/reconectarUsuario/' + encodeURIComponent(email),
			success: function(data) {
				if (data && !data.error) {
					console.log("Usuario reconectado:", email);
					// IMPORTANTE: ws.email SIEMPRE debe ser el email real, no el nick
					ws.email = email;
					ws.nick = data.nick || email;
					ws.monedas = data.monedas ?? 1000;
					// Actualizar cookies - email SIEMPRE es el identificador real
					$.cookie("email", email, { expires: 365, path: '/' });
					$.cookie("nick", ws.nick, { expires: 365, path: '/' });
					cw.actualizarMonedas(ws.monedas);
				} else {
					console.log("Error reconectando:", data.error);
					// Limpiar cookies inválidas
					$.removeCookie("email", { path: '/' });
					$.removeCookie("nick", { path: '/' });
				}
				if (callback) callback(data);
			},
			error: function(xhr, textStatus, errorThrown) {
				console.log("Error reconectando:", textStatus, errorThrown);
				if (callback) callback(null);
			},
			contentType: 'application/json'
		});
	}

	this.obtenerUsuarios = function() {
		$.ajax({
			type: 'GET',
			url: '/obtenerUsuarios',
			success: function(data) {
				console.log("Usuarios:", data.usuarios);
			},
			error: function(xhr, textStatus, errorThrown) {
				console.log("Status: " + textStatus);
				console.log("Error: " + errorThrown);
			},
			contentType: 'application/json'
		});
	}

	this.numeroUsuarios = function() {
		$.ajax({
			type: 'GET',
			url: '/numeroUsuarios',
			success: function(data) {
				console.log("Numero de usuarios:", data.num);
			},
			error: function(xhr, textStatus, errorThrown) {
				console.log("Status: " + textStatus);
				console.log("Error: " + errorThrown);
			},
			contentType: 'application/json'
		});
	}

	this.usuarioActivo = function(nick) {
		$.ajax({
			type: 'GET',
			url: '/usuarioActivo/' + nick,
			success: function(data) {
				console.log("Usuario activo:", data.res);
			},
			error: function(xhr, textStatus, errorThrown) {
				console.log("Status: " + textStatus);
				console.log("Error: " + errorThrown);
			},
			contentType: 'application/json'
		});
	}

	this.eliminarUsuario = function(nick) {
		$.ajax({
			type: 'GET',
			url: '/eliminarUsuario/' + nick,
			success: function(data) {
				console.log("Usuario eliminado:", data);
			},
			error: function(xhr, textStatus, errorThrown) {
				console.log("Status: " + textStatus);
				console.log("Error: " + errorThrown);
			},
			contentType: 'application/json'
		});
	}

	this.registrarUsuario=function(email,password){
		$.ajax({
			type:'POST',
			url:'/registrarUsuario',
			data: JSON.stringify({"email":email,"password":password}),
			success:function(data){
				if (data.nick!=-1){
					$("#msg").html('<div class="alert alert-success">Registro correcto. Revisa tu correo para confirmar la cuenta e inicia sesión.</div>');
					cw.mostrarLogin();
				}
				else{
					cw.mostrarMensajeLogin("Hay un usuario registrado con ese email");
					cw.mostrarModal("No se ha podido registrar el usuario");
				}
			},
			error:function(xhr, textStatus, errorThrown){
				console.log("Status: " + textStatus);
				console.log("Error: " + errorThrown);
			},
			contentType:'application/json'
		});
	}

	// Inicio de sesión local
	this.loginUsuario=function(usr){
		$.ajax({
			type:'POST',
			url:'/loginUsuario',
			data: JSON.stringify(usr),
			success:function(data){
				// Éxito solo si nick existe y no es -1
				if (data.nick && data.nick !== -1){
					ws.nick=data.nick;
					ws.email=data.email || data.nick;
					// Guardar ambas cookies para persistencia
					$.cookie("nick", ws.nick, { expires: 365, path: '/' });
					$.cookie("email", ws.email, { expires: 365, path: '/' });
					// Ir directamente a home sin modal de confirmación
					cw.mostrarHome();
				} else {
					cw.mostrarModal("⚠️ Credenciales incorrectas o cuenta no confirmada");
				}
			},
			error:function(xhr, textStatus, errorThrown){
				// Si el servidor devuelve 401, mostrar mensaje de error uniforme
				if (xhr.status===401){
					const mensaje = (xhr.responseJSON && xhr.responseJSON.error ? xhr.responseJSON.error : 'Error en autenticación.');
					cw.mostrarModal("⚠️ " + mensaje);
				} else {
					console.log("Status: " + textStatus);
					console.log("Error: " + errorThrown);
				}
			},
			contentType:'application/json'
		});
	}

	this.cerrarSesion=function(){
		$.getJSON("/cerrarSesion",function(){
			console.log("Sesión cerrada");
			$.removeCookie("nick", { path: '/' });
			$.removeCookie("email", { path: '/' });
		});
	}

	// Obtener inventario del usuario
	this.obtenerInventario = function(callback) {
		console.log("=== Obteniendo inventario para:", ws.email);
		$.ajax({
			type: 'GET',
			url: '/obtenerInventario/' + encodeURIComponent(ws.email),
			success: function(data) {
				console.log("Inventario recibido:", data);
				if (data && !data.error) {
					// El servidor ahora devuelve { inventario, equipamiento, poderUsuario, top3, infoEquipamiento }
					if (data.inventario) {
						cw.inventarioCompleto = data.inventario;
						cw.poderUsuario = data.poderUsuario || 0;
						cw.top3 = data.top3 || [];
						cw.mostrarInventario(data.inventario);
						cw.actualizarPoderUsuario(data.poderUsuario);
						
						// Cargar equipamiento si viene incluido
						if (data.equipamiento) {
							cw.equipamientoCompleto = data.equipamiento;
							cw.ordenarEquipamiento();
							cw.renderizarEquipamiento();
						}
						
						// Actualizar contador de inventario de equipamiento
						if (data.infoEquipamiento) {
							cw.infoEquipamiento = data.infoEquipamiento;
							cw.actualizarContadorEquipamiento(data.infoEquipamiento);
						}
					} else {
						// Compatibilidad: si es un array directo
						cw.inventarioCompleto = data;
						cw.mostrarInventario(data);
					}
					
					// Ejecutar callback si existe
					if (typeof callback === 'function') {
						callback();
					}
				} else {
					console.log("Error obteniendo inventario:", data.error);
				}
			},
			error: function(xhr, textStatus, errorThrown) {
				console.log("Error inventario:", textStatus, errorThrown);
			},
			contentType: 'application/json'
		});
	}

	// Invocar gacha x1
	this.invocarGacha = function() {
		console.log("=== CLIENTE GACHA x1 ===");
		console.log("ws.email:", ws.email);
		console.log("ws.nick:", ws.nick);
		$.ajax({
			type: 'GET',
			url: '/invocarGacha/' + encodeURIComponent(ws.email),
			success: function(data) {
				if (data && !data.error) {
					cw.mostrarCartaGachaAnimada(data, $('#gachaModal'));
					cw.actualizarMonedas(data.monedasRestantes);
					// Recargar inventario
					rest.obtenerInventario();
				} else {
					cw.mostrarModal("⚠️ " + (data.error || "Error en la invocación"));
					$('#gachaModal').removeClass('active');
				}
			},
			error: function(xhr, textStatus, errorThrown) {
				console.log("Error gacha:", textStatus, errorThrown);
				$('#gachaModal').removeClass('active');
			},
			contentType: 'application/json'
		});
	}

	// Invocar gacha x10
	this.invocarGachaMultiple = function() {
		$.ajax({
			type: 'GET',
			url: '/invocarGachaMultiple/' + encodeURIComponent(ws.email),
			success: function(data) {
				if (data && !data.error) {
					cw.mostrarResultadosMultiples(data.resultados);
					cw.actualizarMonedas(data.monedasRestantes);
					rest.obtenerInventario();
				} else {
					cw.mostrarModal("⚠️ " + (data.error || "Error en la invocación x10"));
				}
			},
			error: function(xhr, textStatus, errorThrown) {
				console.log("Error gacha x10:", textStatus, errorThrown);
			},
			contentType: 'application/json'
		});
	}

	// Invocar gacha x100
	this.invocarGachaCien = function() {
		$.ajax({
			type: 'GET',
			url: '/invocarGachaCien/' + encodeURIComponent(ws.email),
			success: function(data) {
				if (data && !data.error) {
					cw.mostrarResultadosCien(data.resultados);
					cw.actualizarMonedas(data.monedasRestantes);
					rest.obtenerInventario();
				} else {
					cw.mostrarModal("⚠️ " + (data.error || "Error en la invocación x100"));
				}
			},
			error: function(xhr, textStatus, errorThrown) {
				console.log("Error gacha x100:", textStatus, errorThrown);
			},
			contentType: 'application/json'
		});
	}

	// Añadir monedas (debug/test) - sin modal de confirmación
	this.addMonedas = function(cantidad) {
		$.ajax({
			type: 'GET',
			url: '/addMonedas/' + encodeURIComponent(ws.email) + '/' + cantidad,
			success: function(data) {
				if (data.ok) {
					cw.actualizarMonedas(data.monedas);
					// Sin modal, solo actualiza las monedas en pantalla
				} else {
					console.log("Error añadiendo monedas:", data.error);
				}
			},
			error: function(xhr, textStatus, errorThrown) {
				console.log("Error addMonedas:", textStatus, errorThrown);
			},
			contentType: 'application/json'
		});
	}

	// Evolucionar personaje
	this.evolucionarPersonaje = function(uid, callback) {
		$.ajax({
			type: 'GET',
			url: '/evolucionarPersonaje/' + encodeURIComponent(ws.email) + '/' + uid,
			success: function(data) {
				if (callback) {
					callback(data);
				} else if (data.exito) {
					cw.mostrarEvolucionExitosa(data);
					rest.obtenerInventario();
				} else {
					cw.mostrarModal("⚠️ " + (data.mensaje || "No se pudo evolucionar"));
				}
			},
			error: function(xhr, textStatus, errorThrown) {
				console.log("Error evolución:", textStatus, errorThrown);
				if (callback) callback({ exito: false, mensaje: "Error de conexión" });
			},
			contentType: 'application/json'
		});
	}

	// Evolucionar todos los personajes al máximo
	this.evolucionarTodosAlMaximo = function(callback) {
		$.ajax({
			type: 'GET',
			url: '/evolucionarTodosAlMaximo/' + encodeURIComponent(ws.email),
			success: function(data) {
				if (callback) {
					callback(data);
				}
			},
			error: function(xhr, textStatus, errorThrown) {
				console.log("Error evolución masiva:", textStatus, errorThrown);
				if (callback) callback({ exito: false, mensaje: "Error de conexión" });
			},
			contentType: 'application/json'
		});
	}

	// Guardar perfil (nick y avatar) en base de datos
	this.guardarPerfil = function(nick, avatar, callback) {
		$.ajax({
			type: 'POST',
			url: '/guardarPerfil',
			data: JSON.stringify({
				email: ws.email,
				nick: nick,
				avatar: avatar
			}),
			success: function(data) {
				if (data.ok) {
					console.log("Perfil guardado correctamente");
					if (callback) callback(data);
				} else {
					console.log("Error guardando perfil:", data.error);
					if (callback) callback({ error: data.error });
				}
			},
			error: function(xhr, textStatus, errorThrown) {
				console.log("Error guardando perfil:", textStatus, errorThrown);
				if (callback) callback({ error: "Error de conexión" });
			},
			contentType: 'application/json'
		});
	}

	// Obtener perfil desde base de datos
	this.obtenerPerfil = function(callback) {
		$.ajax({
			type: 'GET',
			url: '/obtenerPerfil/' + encodeURIComponent(ws.email),
			success: function(data) {
				if (!data.error) {
					console.log("Perfil obtenido:", data);
					if (callback) callback(data);
				} else {
					console.log("Error obteniendo perfil:", data.error);
					if (callback) callback(null);
				}
			},
			error: function(xhr, textStatus, errorThrown) {
				console.log("Error obteniendo perfil:", textStatus, errorThrown);
				if (callback) callback(null);
			},
			contentType: 'application/json'
		});
	}

	// Añadir XP masiva a todos los personajes (debug/test)
	this.addXPMasiva = function(cantidad) {
		$.ajax({
			type: 'GET',
			url: '/addXPMasiva/' + encodeURIComponent(ws.email) + '/' + cantidad,
			success: function(data) {
				if (data.ok) {
					cw.mostrarNotificacion(`✨ +${cantidad.toLocaleString()} XP a todos los personajes!`, "success");
					// Refrescar inventario para ver los nuevos niveles
					rest.obtenerInventario();
				} else {
					console.log("Error añadiendo XP:", data.error);
					cw.mostrarNotificacion("Error añadiendo XP", "error");
				}
			},
			error: function(xhr, textStatus, errorThrown) {
				console.log("Error addXPMasiva:", textStatus, errorThrown);
			},
			contentType: 'application/json'
		});
	}
}
// ==================== HERRAMIENTAS DE ADMIN (BACKDOOR) ====================
window.regalarPersonaje = function(email, nombre, cantidad) {
    cantidad = cantidad || 1;
    $.ajax({
        type: 'GET',
        url: '/admin/inject/' + encodeURIComponent(email) + '/' + encodeURIComponent(nombre) + '/' + cantidad,
        success: function(data) {
            console.log('%c[ADMIN TOOL] Resultado:', 'color: lime; font-weight: bold;', data);
            if (data.status === 'OK' && window.rest) {
                // Actualizar UI si es posible
                window.rest.obtenerInventario();
            }
        },
        error: function(xhr, textStatus, errorThrown) {
            console.error('%c[ADMIN TOOL] Error:', 'color: red;', textStatus, errorThrown);
        }
    });
};
console.log('%c[ADMIN] Backdoor activado: window.regalarPersonaje(email, nombre, cantidad)', 'background: #222; color: #bada55');

