const nodemailer = require('nodemailer');
const gv = require('./gestorVariables.js');
const baseUrl = (process.env.BASE_URL || 'http://localhost:3000') + '/';

let options = {
	user: process.env.MAIL_USER || '',
	pass: process.env.MAIL_PASS || '' // clave secreta
};
let transporter;

gv.obtenerOptions(function(res) {
	options = res;
	transporter = nodemailer.createTransport({
		service: 'gmail',
		auth: options
	});
});

module.exports.enviarEmail = async function(direccion, key, men) {
	if (!direccion) {
		return;
	}
	// Verificar que el transporter esté inicializado
	if (!transporter) {
		console.warn('[EMAIL] Transporter no inicializado. Intentando crear fallback...');
		// Intentar crear transporter con variables de entorno como fallback
		if (process.env.MAIL_USER && process.env.MAIL_PASS) {
			transporter = nodemailer.createTransport({
				service: 'gmail',
				auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS }
			});
			options.user = process.env.MAIL_USER;
			options.pass = process.env.MAIL_PASS;
		} else {
			console.error('[EMAIL] No se puede enviar email: transporter no configurado y faltan MAIL_USER/MAIL_PASS');
			return { error: true, mensaje: 'Email no configurado' };
		}
	}
	const result = await transporter.sendMail({
		from: options.user,
		to: direccion,
		subject: men,
		text: 'Pulsa aquí para confirmar cuenta',
		html: `<p>Bienvenido a Sistema</p><p><a href="${baseUrl}confirmarUsuario/${direccion}/${key}">Pulsa aquí para confirmar cuenta</a></p>`
	});
	return result;
}


