var Sdk = require("matrix-js-sdk");
var MailParser = require("mailparser").MailParser;
var Q = require('q');
var SMTPServer = require('smtp-server').SMTPServer;

ROOM_ID = '';
IMAGE_TYPES = ['image/jpeg', 'image/png'];

var myUserId = "";
var myAccessToken = "";
var matrix_client = Sdk.createClient({
    baseUrl: "",
    accessToken: myAccessToken,
    userId: myUserId
});

matrix_client.joinRoom(ROOM_ID).done(function(room) {
    console.log("Joined %s", ROOM_ID);
}, function(err) {
    console.log("Could not join %s: %s", ROOM_ID, err);
});

matrix_client.startClient();

function nop() {}

function process_mail(mail) {
    body = mail.from[0].name + "\n";
    body += mail.subject + "\n";
    body += mail.text;
    html_body = "<strong>" + mail.from[0].name + "</strong>\n";
    html_body += "<strong>" + mail.subject + "</strong>\n";
    html_body += mail.text;
    
    body = body.trim();
    html_body = html_body.trim();
    
    html_body = html_body.replace(/\n/g, "<br />");
    
    upload_promises = [];
    
    if (mail.attachments) {
        mail.attachments.forEach(function(attachment) {
            upload_promises.push(matrix_client.uploadContent({
                'name': attachment.fileName,
                'type': attachment.contentType,
                'stream': attachment.content
            }).then(function(resp) {
                //console.log(resp);
                var content_uri = JSON.parse(resp).content_uri; // <-- strange?!?
                attachment.content_uri = content_uri;
                //console.log(attachment);
            }));
        });
    }
    
    Q.all(upload_promises).then(function() {
        matrix_client.sendHtmlMessage(ROOM_ID, body, html_body).then(nop, console.log);
        if (mail.attachments) {
            mail.attachments.forEach(function(attachment) {
                if (IMAGE_TYPES.indexOf(attachment.contentType) > -1) {
                    matrix_client.sendNotice(ROOM_ID, attachment.fileName + ":").then(nop, console.log);
                    matrix_client.sendImageMessage(ROOM_ID, attachment.content_uri, {
                        'mimetype': attachment.contentType,
                        'size': attachment.length
                    }, attachment.fileName).then(nop, console.log);
                } else {
                    matrix_client.sendMessage(ROOM_ID, {
                        'body': attachment.fileName,
                        'url': attachment.content_uri,
                        'filename': attachment.fileName,
                        'msgtype': 'm.file',
                        'info': {
                            'mimetype': attachment.contentType,
                            'size': attachment.length
                        }
                    }).then(nop, console.log);
                }
            });
        }
    }, console.log);
    
}

var smtp_server = new SMTPServer({
    authMethods: [],
    disabledCommands: ['AUTH'],
    onData: function onData(stream, session, callback) {
        stream.on('end', callback);
        
        var mailparser = new MailParser({
            defaultCharset: 'utf-8'
        });
        mailparser.on("end", process_mail);
        stream.pipe(mailparser);
    },
});
smtp_server.on('error', function(err) {
    console.log('Error %s', err.message);
});
smtp_server.listen(1025);

console.log('listening');
