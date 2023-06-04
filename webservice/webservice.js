const verbandonline = require("verbandonline-node-api");
const express = require('express');
const device = require("express-device");
const http = require('http');
const basicAuth = require('basic-auth');
const winston = require('winston');
const crypto = require("crypto");
const dotenv = require('dotenv');
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
        new winston.transports.File({ 'filename': config.get("log.file.webservice") }),
    ],
});

const redisPublish = redis.createClient(redisConfig);
redisPublish.connect();
redisPublish.on('connect', () => {
    logger.info('redisPublish hat sich erfolgreich mit dem Server verbunden');
});
redisPublish.on('error', (err) => {
    logger.error('redisPublish Fehler bei der Verbindung mit Redis: ' + err);
});

const app = express();
app.use(device.capture());
const server = http.Server(app);
const { Server } = require("socket.io");
const io = new Server(server);

verbandonline.setLogger(logger);
verbandonline.setVerbandsUrl(config.get('url.stammesmanager'));
verbandonline.setToken(process.env.verbandonline_adminuser, process.env.verbandonline_adminpassword);

app.use("/", express.static("static"));
app.use(express.json());
app.post('/login', async (req, res) => {
    try {
        if (!req.body.username || req.body.username.length == 0 || !req.body.password || req.body.password.length == 0) {
            logger.warn("ungültige Anfrage, kein Nutzername oder Passwort gefunden");

            res.send({
                'ok': false,
                'info': "ungültige Anfrage, kein Nutzername oder Passwort gefunden."
            });
            res.status(400);
            return;
        }
        const username = req.body.username;
        const password = req.body.password;

        const requestId = crypto.randomBytes(16).toString('hex');
        logger.info(`request for ${username} from IP ${req.ips}, generated requestId ${requestId}`);

        // Filter auf "Admin" und alle Schreibweisen davon
        if (username.toLowerCase().includes("admin")) {
            logger.warn('Loginversuch mit Namensbestandteil "admin" aufgefangen ${username}');
            res.send({
                'ok': false,
                'requestId': requestId,
                'info': "Nutzername darf nicht 'admin' enthalten, Verarbeitung nicht zugelassen."
            });
            res.status(403);
        }

        verbandonline.VerifyLoginID(username, password, stama_id => {
            verbandonline.GetMember(stama_id, stamauser => {
                logger.debug(`send info of ${stama_id} into redis queue`);
                res.send({
                    'ok': true,
                    'requestId': requestId,
                    'info': "Deine Accounts werden angelegt. Das sollte maximal 10 Sekunden dauern."
                });
                res.status(200);

                redisPublish.publish(config.get("queues.accountdata.topic"), // kanal
                    JSON.stringify({
                        [config.get("queues.accountdata.requestId")]: requestId,
                        [config.get("queues.accountdata.stamauser")]: stamauser,
                        [config.get("queues.accountdata.password")]: password
                    }));
                logger.debug(`Anfrage ${requestId} erfolgreich in Redis-Queue übergeben.`);
            }, stama_err => {
                logger.error(`Fehler beim Abrufen der Stama Daten für ${username} ` + stama_err);
            });
        }, stama_err => {
            logger.info("Login beim Stammesmanager durch " + username + " nicht möglich." + stama_err);

            res.send({
                'ok': false,
                'requestId': requestId,
                'info': "Fehler beim Verifizieren des Stammesmanager Logins. Vielleicht wurde das Passwort falsch geschrieben."
            });
            res.status(403);
        });
    } catch (error) {
        logger.error("unbehandelter Fehler");
        logger.error(error);

        res.send({
            'ok': false,
            'requestId': requestId,
            'info': "Nutzername darf nicht 'admin' enthalten, Verarbeitung nicht zugelassen."
        });
        res.status(500);
    }
});


const redisSubscribeResult = redis.createClient(redisConfig);
redisSubscribeResult.on('connect', () => {
    logger.info('redisSubscribeResult hat sich erfolgreich mit dem Server verbunden');
});
redisSubscribeResult.on('error', (err) => {
    logger.error('redisSubscribeResult Fehler bei der Verbindung mit Redis: ' + err);
});

const listener = (message, requestId) => {
    logger.debug(`Nachricht erhalten für RequestId ${requestId}`);
    if (!ioSocketsDict.hasOwnProperty(requestId)) {
        logger.warn(`Es ist eine Antwort für eine requestId eingegangen, die nicht registriert ist. Nachricht wird verworfen: ${message}`);
    } else {
        logger.debug(`Nachricht für Socket ${requestId} eingangen. Nachricht wird an Socket gesendet: ${message}`);
        const socket = ioSocketsDict[requestId];
        socket.emit("antwort", {
            "message": message
        });
    }
}
redisSubscribeResult.connect();
const ioSocketsDict = new Object();

io.on("connection", (socket) => {
    var requestId;

    logger.debug("Neue Verbindung bei Socket IO eingegangen");
    if (!socket.request._query['requestId']) {
        logger.error("invalide Verbindung in socket.io -> missing requestId");
        socket.disconnect();
    } else {
        requestId = socket.request._query['requestId'];
        logger.info(`gültige Verbindung von ${requestId} eingegangen.`);

        ioSocketsDict[requestId] = socket; // speichere die Verbindung im Dictionary, um nachher die eingehenden Nachrichten zuordnen zu können.
        redisSubscribeResult.subscribe(requestId, listener);
    }

    socket.on("disconnect", (reason) => {
        logger.info(`Client ${requestId} disconnected.`);
        delete ioSocketsDict[requestId];
    });
})

server.listen(3000, () => logger.info('Webserver running on port 3000'));
