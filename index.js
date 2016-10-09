var Bridge = require('matrix-appservice-bridge').Bridge;
var MailParser = require('mailparser').MailParser;
var Q = require('q');
var SMTPServer = require('smtp-server').SMTPServer;

DOMAIN = '';
HOMESERVER = 'http://' + DOMAIN + ':8448';
ROOM_ID = '!<insert here>:' + DOMAIN;
REGISTRATION = 'email-bot.yaml';
VIRTUAL_USER_PREFIX = '@email_';

IMAGE_TYPES = ['image/jpeg', 'image/png'];

var bridge = new Bridge({
    homeserverUrl: HOMESERVER,
    domain: DOMAIN,
    registration: REGISTRATION,
    controller: {
        onUserQuery: function(queriedUser) {
            console.log('User ' + queriedUser + ' queried');
            return {};
        },
        onEvent: function(request, context) {}
    }
});
bridge.run(8010); //config object is not used

var bot_intent = bridge.getIntent();

function process_mail(mail) {
    body = mail.subject + '\n';
    body += mail.text;
    html_body = '<strong>' + mail.subject + '</strong>\n';
    html_body += mail.text;
    
    body = body.trim();
    html_body = html_body.trim();
    
    html_body = html_body.replace(/\n/g, '<br />');
    
    var from = mail.from[0];
    var localpart = VIRTUAL_USER_PREFIX;
    var display_name = '<no address>';
    if (from.address) {
        display_name = from.address;
        localpart += from.address.replace('@', '=')
    } else {
        localpart += 'anonymous';
    }
    if (from.name) {
        display_name = from.name + ' (' + display_name + ')';
    }
    var intent = bridge.getIntent(localpart + ':' + DOMAIN);
    intent.setDisplayName(display_name);
    
    upload_promises = [];
    
    if (mail.attachments) {
        mail.attachments.forEach(function(attachment) {
            upload_promises.push(bot_intent.getClient().uploadContent({
                'name': attachment.fileName,
                'type': attachment.contentType,
                'stream': attachment.content
            }).then(function(resp) {
                var content_uri = JSON.parse(resp).content_uri; // <-- strange?!?
                attachment.content_uri = content_uri;
            }));
        });
    }
    
    Q.all(upload_promises).then(function() {
        intent.sendMessage(ROOM_ID, {
            'msgtype': 'm.text',
            'body': body,
            'format': 'org.matrix.custom.html',
            'formatted_body': html_body
        }).catch(console.log);
        if (mail.attachments) {
            mail.attachments.forEach(function(attachment) {
                if (IMAGE_TYPES.indexOf(attachment.contentType) > -1) {
                    intent.sendMessage(ROOM_ID, {
                        'msgtype': 'm.notice',
                        'body': attachment.fileName + ':'
                    }).catch(console.log);
                    intent.sendMessage(ROOM_ID, {
                        'msgtype': 'm.image',
                        'body': attachment.fileName,
                        'url': attachment.content_uri,
                        'info': {
                            'mimetype': attachment.contentType,
                            'size': attachment.length
                        }
                    }).catch(console.log);
                } else {
                    intent.sendMessage(ROOM_ID, {
                        'body': attachment.fileName,
                        'url': attachment.content_uri,
                        'filename': attachment.fileName,
                        'msgtype': 'm.file',
                        'info': {
                            'mimetype': attachment.contentType,
                            'size': attachment.length
                        }
                    }).catch(console.log);
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
        mailparser.on('end', process_mail);
        stream.pipe(mailparser);
    },
});
smtp_server.on('error', function(err) {
    console.log('Error %s', err.message);
});
smtp_server.listen(1025);

console.log('listening');
