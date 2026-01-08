const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID || 'proyecto-procesos-474706';
const SECRET_PASS = process.env.SECRET_CLAVECORREO || 'CLAVECORREO';
const SECRET_USER = process.env.SECRET_EMAIL || 'EMAIL';

let client;

async function accessCLAVECORREO() {
	if (process.env.MAIL_PASS) {
		return process.env.MAIL_PASS;
	}
	const name = `projects/${PROJECT_ID}/secrets/${SECRET_PASS}/versions/1`;
	try {
		if (!client) client = new SecretManagerServiceClient();
		const [version] = await client.accessSecretVersion({ name: name });
		const datos = version.payload.data.toString('utf8');
		return datos;
	} catch (err) {
		throw err;
	}
}

async function accessEMAIL() {
	if (process.env.MAIL_USER) {
		return process.env.MAIL_USER;
	}
	const name = `projects/${PROJECT_ID}/secrets/${SECRET_USER}/versions/1`;
	try {
		if (!client) client = new SecretManagerServiceClient();
		const [version] = await client.accessSecretVersion({ name: name });
		const datos = version.payload.data.toString('utf8');
		return datos;
	} catch (err) {
		throw err;
	}
}

module.exports.obtenerOptions = async function(callback) {
	let options = { user: process.env.MAIL_USER || '', pass: process.env.MAIL_PASS || '' };
	try {
		options.pass = await accessCLAVECORREO();
	} catch (err) {}
	try {
		options.user = await accessEMAIL();
	} catch (err) {}
	callback(options);
};