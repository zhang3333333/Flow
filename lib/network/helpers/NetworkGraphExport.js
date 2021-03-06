const rfr = require('rfr');
const Logger = rfr('lib/utils/Logger.js');
const fs = require('fs');

const http = require('http');
const WebSocket = require('ws');

const Settings = rfr('lib/utils/Settings.js');

const _ = require('lodash');

class NetworkGraphExport {
    constructor(options) {
        options = options || {};
        this._networks = [];
        this._timeframes = [];

        this._messages = [];

        if (options.networks) {
            for (let network of options.networks) {
                this.addNetwork(network);
            }
        }

        this._sockets = [];
        this.createBroadcastSocket();

        this._toBeClosed = false;

        this.throttledBroadcast = _.debounce(this.broadcast, Settings.network.testing.networkGraphBroadcastDebounceDelay);
    }

    addMessage(from, to, msg) {
        this._messages.push({
            from: ''+from,
            to: ''+to,
            type: ''+msg.type,
            time: new Date()
        });
        this.throttledBroadcast();
    }

    createBroadcastSocket() {
        if (Settings.network.testing.enableNetworkGraphBroadcast) {
            const server = http.createServer((req, res) => {
                res.writeHead(200);
                res.end('Broadcast Socket\n');
            }).listen(Settings.network.testing.networkGraphBroadcastPort);
            this._wss = new WebSocket.Server({server: server});
            this._wss.on('connection', (ws) => { this._onConnection(ws) });            
        }
    }

    _onConnection(ws) {
        ws.on('message', msg => this.broadcast());
        this._sockets.push(ws);
    }

    broadcast() {
        var toSend = JSON.stringify({name: 'ws', data: this._timeframes, messages: this._messages},null,2);
        var sendTo = (ws)=>{
            ws.send(toSend, null, ()=>{
                if (this._toBeClosed) {
                    ws.close();
                }
            });
        };
        for (let ws of this._sockets) {
            if (ws.readyState == WebSocket.OPEN) {
                sendTo(ws);
            }
        }
    }

    finishBroadcast() {
        this._toBeClosed = true;
        this.throttledBroadcast();
        this.throttledBroadcast.flush();
    }

    save(filename) {
        let data = {
            name: '',
            data: this._timeframes,
            messages: this._messages
        };

        fs.writeFileSync(filename, JSON.stringify(data,null,2)); 
    }

    setTimeframe() {
        let exportObject = this.getExportObject();
        this._timeframes.push({
            time: new Date(),
            nodes: exportObject.nodes,
            edges: exportObject.edges
        });

        this.throttledBroadcast();
    }

    addNetwork(network) {
        this._networks.push(network);
    }

    getExportObject() {
        let nodes = [];
        let edges = [];

        /// nodes
        for (let network of this._networks) {
            nodes.push({
                label: ''+network.localPeerAddress,
                id: ''+network.localPeerAddress,
                peerAddress: network.localPeerAddress, /// will delete this property before real export
                network: network /// will delete this property before real export
            });
        }

        let i = 0;
        for (let fromNode of nodes) {
            for (let toNode of nodes) {
                if (fromNode.network.knownPeerAddresses.known(toNode.peerAddress)) {

                    edges.push({
                        id: ('e'+fromNode.id+toNode.id),
                        status: fromNode.network.knownPeerAddresses.getPeerAddressStatus(toNode.peerAddress),
                        source: fromNode.id,
                        target: toNode.id
                    });
                }
            }
        }

        for (let node of nodes) {
            delete node.network;
            delete node.peerAddress;
        }

        return {
            nodes: nodes,
            edges: edges
        };
    }
}

module.exports = NetworkGraphExport;
