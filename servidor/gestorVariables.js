const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

// En modo test o desarrollo local, no intentar conectar a GCP
const IS_TEST_MODE = process.env.NODE_ENV === 'test' || 
                     (process.env.MAIL_USER && process.env.MAIL_PASS);

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
	
	// Si ya tenemos las credenciales por variables de entorno, no intentar GCP
	if (IS_TEST_MODE && options.user && options.pass) {
		callback(options);
		return;
	}
	
	// Solo intentar GCP si no hay variables de entorno
	try {
		if (!options.pass) options.pass = await accessCLAVECORREO();
	} catch (err) {
		if (!IS_TEST_MODE) console.warn('[GV] No se pudo obtener CLAVECORREO de GCP:', err.message);
	}
	try {
		if (!options.user) options.user = await accessEMAIL();
	} catch (err) {
		if (!IS_TEST_MODE) console.warn('[GV] No se pudo obtener EMAIL de GCP:', err.message);
	}
	callback(options);
};