const verbandonline = require("verbandonline-node-api");
const express = require('express');
const basicAuth = require('basic-auth');
const winston = require('winston');
const dotenv = require('dotenv');
const config = require('config');
const stammesmanagerToNextcloud = require("stammesmanager-to-nextcloud");
const keystore = require("small-async-keystore");

const app = express();
app.set('trust proxy', true);

dotenv.config();
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
    transports: [
      new winston.transports.Console({'timestamp': true}),
      new winston.transports.File({'filename': 'log/pbw-accountmanagement.log'}),
    ],
});

verbandonline.setLogger(logger);
stammesmanagerToNextcloud.setLogger(logger);

verbandonline.setVerbandsUrl(config.get('url.stammesmanager'));
verbandonline.setToken(process.env.verbandonline_adminuser, process.env.verbandonline_adminpassword);

app.get('/', async (req, res) => {
    try{
        logger.info("request from " + req.ips);
        const user = basicAuth(req);
    
        if (!user || !user.name || !user.pass) {
        logger.debug("[401] Invalid login, missing username and password");
        res.status(401).set('WWW-Authenticate', 'Basic realm="Username/Password Test against verbandonline.org/PBW_Bund"').send();
        return;
        }

        // Filter auf "Admin" und alle Schreibweisen davon
        if(user.name.toLowerCase().includes("admin")){
            logger.warn("Loginversuch mit Namensbestandteil 'admin' aufgefangen ${username}");
            res.send("Nutzername darf nicht 'admin' enthalten, Verarbeitung nicht zugelassen.");
            res.status(403);
        }

        verbandonline.VerifyLoginID(user.name, user.pass, stama_id => {
            // gültige Logindaten gegenüber Stammesmananger
            logger.info("gültiger Stammesmanager Login von " + user.name);
            pre_res = "Login in den Stammesmanager erfolgreich verifiziert.<br>";

            // Speichere Account im Async Keystore
            keystore.insertPassword(user.name, user.pass);

            stammesmanagerToNextcloud.transferUserToNextcloud(user.name, user.pass, stama_id, (nextcloud_res => {
                // Anlage Nutzeraccount in der Nextcloud hat funktioniert
                logger.info("Nextcloud Zugriff für " + user.name + " war erfolgreich");

                res.send(pre_res + nextcloud_res);
                res.status(200);
            }), nextcloud_err => {
                logger.error("Fehler beim Anlegen des Nextcloud Users für " + user.name);
                logger.error(nextcloud_err);

                res.send(pre_res + "Fehler beim Anlegen des Nextcloud Accounts<br>" + nextcloud_err);
                res.status(500);
            })
        }, stama_err => {
            logger.info("Login beim Stammesmanager durch " + user.name + " nicht möglich.");
            logger.info(stama_err);

            res.send("Fehler beim Verifizieren des Stammesmanager Logins<br>" + stama_err);
            res.status(403);
        });
    } catch (error) {
        logger.error("unbehandelter Fehler");
        logger.error(error);

        res.send("unbehandelter Fehler");
        res.status(500);
    }
});

app.listen(3000, () => logger.info('Server running on port 3000'));
