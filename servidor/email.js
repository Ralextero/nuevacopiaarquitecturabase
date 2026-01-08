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
	const result = await transporter.sendMail({
		from: options.user,
		to: direccion,
		subject: men,
		text: 'Pulsa aquí para confirmar cuenta',
		html: `<p>Bienvenido a Sistema</p><p><a href="${baseUrl}confirmarUsuario/${direccion}/${key}">Pulsa aquí para confirmar cuenta</a></p>`
	});
	return result;
}


