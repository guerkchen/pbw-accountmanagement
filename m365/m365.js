const { Client } = require("@microsoft/microsoft-graph-client");
const { TokenCredentialAuthenticationProvider } = require("@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials");
const { ClientSecretCredential } = require("@azure/identity");
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
        new winston.transports.File({ 'filename': config.get("log.file.m365") }),
    ],
});

const redisSubscribe = redis.createClient(redisConfig);
redisSubscribe.on('connect', () => {
    logger.info('redisSubscribe hat sich erfolgreich mit dem Server verbunden');
});
redisSubscribe.on('error', (err) => {
    logger.error('redisSubscribe Fehler bei der Verbindung mit Redis: ' + err);
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
redisSubscribe.connect();
redisSubscribe.subscribe(config.get("queues.accountdata.topic"), listener);

const credential = new ClientSecretCredential(process.env.tenantId, process.env.clientId, process.env.clientSecret);
const authProvider = new TokenCredentialAuthenticationProvider(credential, {
    scopes: ["https://graph.microsoft.com/.default"]
});

const client = Client.initWithMiddleware({
    debugLogging: true,
    authProvider // Use the authProvider object to create the class.
});

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
    redisWriteResult.publish(requestId, `Microsoft365: ${msg}`); // no json msg
}

// Quelle: https://learn.microsoft.com/de-de/graph/api/user-post-users?view=graph-rest-1.0&tabs=http
async function createUser(displayName, mailNickname, userPrincipalName, password) {
    logger.debug(`createUser(${displayName}, ${mailNickname}, ${userPrincipalName}, ***)`);
    const usercontent = {
        "accountEnabled": true,
        "displayName": displayName,
        "mailNickname": mailNickname,
        "passwordPolicies": "DisableStrongPassword",
        "passwordProfile": {
            "password": password,
        },
        "userPrincipalName": userPrincipalName,
    }

    try {
        var m365user = await client.api("/users").post(usercontent);
        logger.info(`User ${userPrincipalName} erfolgreich erstellt mit der Id ${m365user.id}`);
        return m365user;
    } catch (error) {
        logger.error(`Fehler beim Erstellen des M365 Users für ${userPrincipalName}`);
        logger.error(error);
        return null;
    }
}

// Quelle: https://learn.microsoft.com/en-us/graph/api/group-post-members?view=graph-rest-1.0&tabs=http
async function addUserToGroup(userid, groupid) {
    logger.debug(`addUserToGroup(${userid}, ${groupid})`);
    const directoryObject = {
        '@odata.id': `https://graph.microsoft.com/v1.0/directoryObjects/${userid}`
    };

    try {
        await client.api(`/groups/${groupid}/members/$ref`).post(directoryObject);
        logger.info(`User ${userid} erfolgreich in die Gruppe ${groupid} hinzugefügt`);
        return true;
    } catch (error) {
        logger.error(`Fehler beim hinzufügen des Users ${userid} zur Gruppe ${groupid}`);
        logger.error(error);
        return false;
    }
}

// Quelle: https://learn.microsoft.com/en-us/graph/api/user-list-memberof?view=graph-rest-1.0&tabs=http
async function getGroupsOfUser(userid) {
    logger.debug(`getGroupsOfUser(${userid})`);
    try {
        var result = await client.api(`/users/${userid}/memberOf`).get();
        return result;
    } catch (error) {
        logger.error(`Fehler beim Auslesen der Gruppe für den User ${userid}`);
        logger.error(error);
        return null;
    }
}

// Quelle: https://learn.microsoft.com/en-us/graph/api/user-list?view=graph-rest-1.0&tabs=javascript
async function searchUser(userPrincipalName) {
    logger.debug(`searchUser(${userPrincipalName})`);
    try {
        // Quelle Filter: https://learn.microsoft.com/en-us/graph/filter-query-parameter?tabs=http
        var result = await client.api(`/users/`).filter(`userPrincipalName eq \'${userPrincipalName}\'`).get();

        if (result.value.length == 0) {
            return null;
        } else {
            return result.value[0];
        }
    } catch (error) {
        logger.error(`Fehler beim Suchen des Users ${userPrincipalName}`);
        logger.error(error);
        return null;
    }
}

// Quelle: https://learn.microsoft.com/en-us/graph/api/user-update
async function updatePasswordOfUser(userid, password) {
    logger.debug(`updatePasswordOfUser(${userid}, ***)`)

    const usercontent = {
        "passwordPolicies": "DisableStrongPassword",
        "passwordProfile": {
            "forceChangePasswordNextSignIn": false,
            "password": password
        }
    };

    try {
        await client.api(`/users/${userid}`).update(usercontent);
        return true;
    } catch (error) {
        logger.error(`Fehler beim Aktualisieren des Passworts für den User ${userid}`);
        logger.error(error);
        return false;
    }
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

function getUserPrincipalName(userlogin) {
    return userlogin + config.get("m365.mail");
}

async function handleUser(stamaUser, password, requestId) {
    const userlogin = stamaUser[config.get("stamakey.userlogin")]
    logger.info(`Anfrage für den Nutzer ${userlogin}`);

    var m365user = await searchUser(getUserPrincipalName(userlogin));
    if (m365user != null) {
        logger.info(`Nutzer ${userlogin} existiert bereits.`);
        // Diese API verwaltet nur Nutzer, die durch sie selbst angelegt wurden.
        // Das findet die API heraus, weil alle automatisch angelegten Nutzer in der Gruppe 'Automatisch generierte Nutzer' hinzugefügt werden.
        // Die ID der Gruppe ist '3c414e20-c522-437d-8f34-6d5cfa2b83e3'
        const groups = await getGroupsOfUser(m365user.id);
        var inGruppeAutomatischGeneriert = false;
        groups.value.forEach(group => {
            if (group.id == process.env.automatischGeneriertGruppeId) {
                inGruppeAutomatischGeneriert = true;
            }
        });

        if (!inGruppeAutomatischGeneriert) {
            feedbackEvent(requestId, `Nutzer ${userlogin} konnte nicht angepasst werden, da er nicht in der Gruppe 'Automatisch generierte Nutzer' ist`);
            return false;
        }

        // Das Passwort wird angepasst
        if(await updatePasswordOfUser(m365user.id, password)){
            feedbackEvent(requestId, `Nutzer ${userlogin} existiert bereits, Passwort wurde aktualisiert`);
        } else {
            feedbackEvent(requestId, `Nutzer ${userlogin} existiert bereits, Passwort konnte nicht aktualisiert werden`);
        }
    } else {
        const displayname = getDisplayName(stamaUser);
        const mailNickname = userlogin;
        const userPrincipalName = getUserPrincipalName(userlogin);
        m365user = await createUser(displayname, mailNickname, userPrincipalName, password);
        if(!m365user){
            feedbackEvent(requestId, `Nutzer ${userPrincipalName} konnte nicht angelegt werden`);
        }

        await addUserToGroup(m365user.id, process.env.automatischGeneriertGruppeId);
        feedbackEvent(requestId, `Nutzer ${userPrincipalName} wurde angelegt`);
    }

    logger.debug(`M365 Account für User ${userlogin} wurde bearbeitet.`);
}