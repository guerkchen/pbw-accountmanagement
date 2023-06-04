const nextcloud = require('nextcloud-node-client');
const dotenv = require('dotenv');
const winston = require('winston');
const redis = require("redis");

process.env["NODE_CONFIG_DIR"] = __dirname + "/" + process.env.CONFIG_DIR;
const config = require('config');
dotenv.config({path: process.env.NODE_CONFIG_DIR + '.env'});

var redisConfig;
if(process.env["STAGE"] == "test"){
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
        new winston.transports.File({ 'filename': config.get("log.file.nextcloud") }),
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
    if(channel == config.get("queues.accountdata.topic")){
        try{
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

const nextcloudServer = new nextcloud.Server({
    basicAuth: { 
            username: process.env.nextcloud_adminuser,
            password: process.env.nextcloud_adminpassword,
        },
        url: config.get('url.nextcloud'),
});
const nextcloudClient = new nextcloud.Client(nextcloudServer);

const redisWriteResult = redis.createClient(redisConfig);
redisWriteResult.on('connect', () => {
    logger.info('redisWriteResult hat sich erfolgreich mit dem Server verbunden');
});
redisWriteResult.on('error', (err) => {
    logger.error('redisWriteResult Fehler bei der Verbindung mit Redis: ' + err);
});
redisWriteResult.connect();
async function feedbackEvent(requestId, msg){
    logger.info(`${requestId} - ${msg}`);
    redisWriteResult.publish(requestId, `Nextcloud: ${msg}`); // no json msg
}

function getDisplayName(stamaUser) {
    if (stamaUser[config.get("stamakey.pfadfindername")] != "") {
        return stamaUser[config.get("stamakey.pfadfindername")];
    } else if (stamaUser[config.get("stamakey.vorname")] != "" && stamaUser[config.get("stamakey.nachname")] != "") {
        return stamaUser[config.get("stamakey.vorname")] + " " + stamaUser[config.get("stamakey.nachname")];
    } else {
        return stamaUser[config.get("stamakey.userlogin")];
    }
}

/**
 * 
 * @param {string} usr Loginname der Person beim Stammesmanager (wird auch der Nextcloud Login)
 * @param {string} pwd Passwort der Person beim Stammesmanager (wird auch der Nextlcoud Login)
 * @param {int} id ID der Person beim Stammesmanager. Wird für die Gruppenabfrage genutzt.
 * @param {callback function(string)} res Callback, wird nur bei Erfolg gerufen
 * @param {callback function(string)} err Error, wird nur bei Error gerufen
 */
async function handleUser(stamaUser, password, requestId){
    userlogin = stamaUser[config.get("stamakey.userlogin")]
    logger.info(`Anfrage für den Nutzer ${userlogin}`);

    const user = await nextcloudClient.getUser(userlogin);
    logger.debug(`user gefunden ${user}`);
    if(user){
        // Es gibt den Nutzer bereits, deswegen ändern wir nur das Passwort
        logger.debug(`Nutzer ${userlogin} existiert bereits, Passwort wird angepasst`);
        user.setPassword(password);
        feedbackEvent(requestId, `User ${userlogin} existiert bereits, Passwort wurde angepasst`);
    } else {
        logger.debug(`Lege User ${userlogin} an`);
        const email = stamaUser[config.get("stamakey.email")]
        const newUser = await nextcloudClient.createUser({"id": userlogin, "email": email, "password": password });
        newUser.setDisplayName(getDisplayName(stamaUser));
        newUser.setQuota("1 GB");
        newUser.setLanguage("de");

        feedbackEvent(requestId, `User ${userlogin} erfolgreich angelegt`);
    }
}