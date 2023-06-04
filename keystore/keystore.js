const forge = require('node-forge');
const write = require('write');
const readfile = require("read-file");
const fs = require('fs');
const nosql = require('nosql');
const { base64encode, base64decode } = require('nodejs-base64');
const dotenv = require('dotenv');
const winston = require('winston');
const redis = require("redis");

process.env["NODE_CONFIG_DIR"] = __dirname + "/" + process.env.CONFIG_DIR;
const config = require('config');
dotenv.config({ path: process.env.NODE_CONFIG_DIR + '.env' });

var redisConfig;
if (process.env["STAGE"] == "test") {
    redisConfig = require(process.env.NODE_CONFIG_DIR + "/" + "redis-config.test.json");
} else {
    redisConfig = require(process.env.NODE_CONFIG_DIR + "/" + "redis-config.json");
}

var logger = winston.createLogger({
    level: config.get("log.level"),
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console({ 'timestamp': true }),
        new winston.transports.File({ 'filename': config.get("log.file.keystore") }),
    ],
});

const subscriber = redis.createClient(redisConfig);
subscriber.on('connect', () => {
    logger.info('Subscriber hat sich erfolgreich mit dem Server verbunden');
});
subscriber.on('error', (err) => {
    logger.error('Fehler bei der Verbindung mit Redis: ' + err);
});

const listener = (message, channel) => {
    logger.debug(`Nachricht erhalten im Kanal ${channel}`);
    if (channel == config.get("queues.accountdata.topic")) {
        try {
            const payload = JSON.parse(message);
            handleUser(payload[config.get("queues.accountdata.stamauser")], payload[config.get("queues.accountdata.password")], payload[config.get("queues.accountdata.requestId")]);
        } catch (e) {
            logger.warn(`Fehler bei der Bearbeitung der Nachricht ${e}`);
        }
    } else {
        logger.info(`Nachricht aus Kanal ${channel}: ${message}`);
    }
}
subscriber.connect();
subscriber.subscribe(config.get("queues.accountdata.topic"), listener);

const pki = forge.pki;

const keystoreDB = nosql.load(config.get("keystore.keystoreDB"));
const publickey_filename = config.get("keystore.publickeyFile");
const privatekey_filename = config.get("keystore.privatekeyFile");

const redisWriteResult = redis.createClient(redisConfig);
redisWriteResult.on('connect', () => {
    logger.info('redisWriteResult hat sich erfolgreich mit dem Server verbunden');
});
redisWriteResult.on('error', (err) => {
    logger.error('redisWriteResult Fehler bei der Verbindung mit Redis: ' + err);
});
redisWriteResult.connect();
async function feedbackEvent(requestId, msg) {
    logger.info(`${requestId} - ${msg}`);
    redisWriteResult.publish(requestId, `Keystore: ${msg}`); // no json msg
}

async function handleUser(stamaUser, password, requestId) {
    username = stamaUser[[config.get("stamakey.userlogin")]];
    insertPassword(username, password, requestId);
}

function createKeypair() {
    logger.verbose("createKeypair()");
    const keypair = pki.rsa.generateKeyPair();
    const keyEncryptionKey = base64decode(process.env.keyEncryptionKey);

    const publicPem = pki.publicKeyToPem(keypair.publicKey);
    const encryptedPrivatePem = pki.encryptRsaPrivateKey(keypair.privateKey, keyEncryptionKey, { algorithm: 'aes256' });

    logger.info("Write new Keys to file");
    write.sync(publickey_filename, publicPem);
    write.sync(privatekey_filename, encryptedPrivatePem);
}

async function insertPassword(username, password, requestId) {
    logger.verbose(`insertPassword(${username}, ...)`);

    // read public key
    logger.debug("read publickey from file");
    const publicKey = pki.publicKeyFromPem(readfile.sync(publickey_filename, 'utf8'));

    // generate pepper
    // the pepper is not futher used. When decryting the password, simpley cut the pepper length from the end.
    // this way, it is impossible to use this database for checking the password, without bruteforcing the whole pepper range
    logger.verbose("generate pepper");
    const pepper = forge.random.getBytesSync(config.get("keystore.pepperLength"));
    const pepperedPassoword = password + pepper;

    // encrypt password
    const encryptedPassword = publicKey.encrypt(pepperedPassoword);

    keystoreDB.insert({
        "username": username,
        "pepperLength": config.get("keystore.pepperLength"),
        "password": base64encode(encryptedPassword)
    }).callback(err => {
        if (err) {
            feedbackEvent(requestId, "Fehler beim verschlüsselten Abspeichern des Datensatzes.");
        } else {
            feedbackEvent(requestId, "Passwort wurde verschlüsselt abgelegt.");
        }
    });
}

async function getPassword(username) {
    logger.verbose(`getPassword(${username}, ...)`);
    var keyEncryptionKey = base64decode(process.env.keyEncryptionKey);

    logger.debug("read encrypted private key from file");
    const encryptedPrivatePem = readfile.sync(privatekey_filename, 'utf8');
    const privateKey = pki.decryptRsaPrivateKey(encryptedPrivatePem, keyEncryptionKey);

    logger.debug("read password from db");
    keystoreDB.find().make(filter => {
        filter.search("username", username);
        filter.callback((err, res) => {
            if (err) {
                logger.error("Fehler beim Suchen des Users ", err);
            } else {
                if(res.length == 0){
                    logger.error(`Nutzer ${username} nicht gefunden`);
                } else if (res.length > 1){
                    logger.error(`Nutzer ${username} nicht eindeutig gefunden `, res.length);
                }

                const entry = res[0];

                // decrypt password & check salt
                const encryptedPassword = base64decode(entry["password"]);
                const pepperedPassoword = privateKey.decrypt(encryptedPassword);

                // remove salt
                const password = pepperedPassoword.substring(0, pepperedPassoword.length - entry["pepperLength"]);
            }
        })
    })

}

function init() {
    if (!fs.existsSync(publickey_filename)) {
        createKeypair();
    }
}

init();