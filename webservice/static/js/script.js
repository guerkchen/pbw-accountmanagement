var usernameField;
var passwordField;
var feedbackField;

function init(){
    usernameField = document.getElementById('username');
    passwordField = document.getElementById('password');
    feedbackField = document.getElementById('textarea-result');

    usernameField.value = "";
    passwordField.value = "";
    feedbackField.value = 'Nachdem du auf "Account synchroniseren" geklickt hast, werden hier deine Ergebnisse angezeigt.'
}

// Wird vom Button "Account synchronisieren" aufgerufen
function syncAccounts() {
    feedbackField.value = 'Hier kannst du sehen, ob das Anlegen der Accounts funktioniert hat. Falls Probleme auftreten, die du nicht alleine lösen kannst, gibt bitte immer diesen Textblock mit an.\n';

    const url = location.protocol + "//" + location.hostname + ":" + location.port + "/login";
    fetch(url, {
        'method': 'POST',
        'headers': {
            "Content-type": "application/json; charset=UTF-8"
        },
        'body': JSON.stringify({
            "username": usernameField.value,
            "password": passwordField.value
        })
    }).then(response => response.json())
    .then(response => {
        if(response.requestId){
            feedbackField.value += `\nAnfragen-ID: ${response.requestId}`
        }
        if(response.info){
            feedbackField.value += `\n${response.info}`
        }
        if(response.ok){
            feedbackField.value += '\n';
            connectWebsocket(response.requestId);
        } else {
            feedbackField.value += `\nFehler`
        }
    })
    .catch(error => console.log(error));
}

// Setup the websocket connection to the server and return socket object
function connectWebsocket(requestId) {

    const url = location.protocol + "//" + location.hostname + ":" + location.port;
    var socket = io(url, {
        'reconnection limit' : 1000, 
        'max reconnection attempts' : 5,
        'query': `requestId=${requestId}`
    });
    socket.on('antwort', (data) => {
        feedbackField.value += '\n' + data.message;
        feedbackField.scrollTop = feedbackField.scrollHeight 
    });
}
