'use strict'; //it is used if ws checks out errors similar to raise_erroras in flask
var CryptoJS = require('crypto');
var app = require('express'); // for routing purposes just like in flask
var bodyParser = require('body-parser');
var WebSocket = require('ws');
'use strict'; //it is used if ws checks out errors similar to raise_erroras in flask
var http_port = process.env.HTTP_PORT || 3001;
var p2p_port = process.env.P2P_PORT || 6001;
var initialPeers = process.env.PEERS ? process.env.PEERS.split(',') : [];
var Block = /** @class */ (function () {
    function Block(index, previous_hash, timestamp, data, hash) {
        this.index = index;
        this.previous_hash = previous_hash;
        this.timestamp = timestamp;
        this.data = data;
        this.hash = hash;
    }
    return Block;
}());
var sockets = [];
var messageType = {
    QUERY_LATEST: 0,
    QUERY_ALL: 1,
    RESPONSE_BLOCKCHAIN: 2
};
var calculateHashForBlock = function (block) {
    return calculateHash(block.index, block.previousHash, block.timestamp, block.data);
};
var initHttpServer = function () {
    var app = app();
    app.use(bodyParser.json());
    app.get('/blocks', function (req, res) { return res.send(JSON.stringify(blockchain)); });
    app.post('/mineBlock', function (req, res) {
        var newBlock = generateNextBlock(req.body.data);
        addBlock(newBlock);
        broadcastMessage(responseLatestMsg());
        console.log("block aded : " + JSON.stringify(newBlock));
        res.send();
    });
    app.get('/peers', function (req, res) {
        res.send(sockets.map(function (s) { return s._socket.remoteAddress + ':' + s._socket.remotePort; }));
    });
    app.post('/addPeer', function (req, res) {
        connectToPeers([req.body.peer]);
        res.send();
    });
    app.listen(http_port, function () { return console.log("listening http on port:" + http_port); });
};
var initP2PServer = function () {
    var server = new WebSocket.Server({ port: p2p_port });
    server.on('connection', function (ws) { return initConnection(ws); });
    console.log('listening websocket p2p port on :' + p2p_port);
};
var addBlock = function (newBlock) {
    if (isValidNewBlock(newBlock, getLatestBlock())) {
        blockchain.push(newBlock);
    }
};
var generateNextBlock = function (blockData) {
    var previousBlock = getLatestBlock();
    var nextIndex = previousBlock.index + 1;
    var nextTimeStamp = new Date().getTime() / 1000;
    var nextHash = calculateHash(nextIndex, previousBlock.hash, nextTimeStamp, blockData);
    return new Block(nextIndex, previousBlock.hash, nextTimeStamp, blockData, nextHash);
};
var calculateHash = function (index, previous_hash, timestamp, data) {
    return CryptoJS.SHA256(index + previous_hash + timestamp + data).toString();
};
var getGenesisBlock = function () {
    return new Block(0, "0", new Date().getTime() / 1000, 'Valar Morghulis', "816534932c2b7154836da6afc367695e6337db8a921823784c14378abed4f7d7");
};
var blockchain = [getGenesisBlock()];
var initConnection = function (ws) {
    sockets.push(ws);
    initMessageHandler(ws);
    initErrorHandler(ws);
    write(ws, queryChainLengthMsg());
};
var initErrorHandler = function (ws) {
    var closeConnection = function (ws) {
        console.log("connection failed " + ws.url);
        sockets.splice(sockets.indexOf(ws), 1);
    };
    ws.on('close', function () { return closeConnection(ws); });
    ws.on('error', function () { return closeConnection(ws); });
};
var queryChainLengthMsg = function () { return ({
    'type': messageType.QUERY_LATEST
}); };
var initMessageHandler = function (ws) {
    ws.on('message', function (data) {
        var message = JSON.parse(data);
        console.log("received msg" + JSON.stringify(message));
        switch (message.type) {
            case messageType.QUERY_LATEST:
                write(ws, responseLatestMsg());
                break;
            case messageType.QUERY_ALL:
                write(ws, responseChainMsg());
                break;
            case messageType.RESPONSE_BLOCKCHAIN:
                handleBlockchainResponse(message);
                break;
        }
    });
};
var handleBlockchainResponse = function (message) {
    var receivedBlocks = JSON.parse(message.data).sort(function (b1, b2) { return (b1.index - b2.index); });
    var latestBlockReceived = receivedBlocks[receivedBlocks.length - 1];
    var latestBlockHeld = getLatestBlock();
    if (latestBlockReceived.index > latestBlockHeld.index) {
        console.log('blockchain possibly behind.We got: ' + latestBlockHeld.index + 'peer got: ' + latestBlockReceived.index);
        if (latestBlockHeld.hash === latestBlockReceived.previous_hash) {
            console.log("We can append the received block");
            blockchain.push(latestBlockReceived);
            broadcastMessage(responseLatestMsg());
        }
        else if (receivedBlocks.length === 1) {
            console.log("We have to query the chain from our peer");
            broadcastMessage(queryAllMsg());
        }
        else {
            console.log("received blockchain is longer than current blockchain");
            replaceChain(receivedBlocks);
        }
    }
    else {
        console.log("received blockchain is not longer than current blockchain");
    }
};
var queryAllMsg = function () { return ({
    'type': messageType.QUERY_ALL
}); };
var replaceChain = function (newBlocks) {
    if (isValidChain(newBlocks) && newBlocks.length > blockchain.length) {
        console.log("received blockchain is valid.Replacing current blockschinwe recived");
        blockchain = newBlocks;
        broadcastMessage(responseLatestMsg());
    }
    else {
        console.log("Invalid blockchain");
    }
};
var isValidChain = function (blockchainToValidate) {
    if (JSON.stringify(blockchainToValidate[0]) != JSON.stringify(getGenesisBlock)) {
        return false;
    }
    var tempBlocks = [blockchainToValidate[0]];
    for (var i = 1; i < blockchainToValidate.length; i++) {
        if (isValidNewBlock(blockchainToValidate[i], tempBlocks[i - 1])) {
            tempBlocks.push(blockchainToValidate[i]);
        }
        else {
            return false;
        }
    }
    return true;
};
var isValidNewBlock = function (newBlock, previousBlock) {
    if (previousBlock.index + 1 != newBlock.index) {
        console.log("Invalid index");
        return false;
    }
    else if (previousBlock.hash != newBlock.previous_hash) {
        console.log("Invalidprevious hash");
        return false;
    }
    else if (calculateHashForBlock(newBlock) != newBlock.hash) {
        console.log(typeof (newBlock.hash)) + ' ' + typeof (calculateHashForBlock(newBlock));
        console.log('invalid hash: ' + calculateHashForBlock(newBlock) + ' ' + newBlock.hash);
        return false;
    }
    return true;
};
var broadcastMessage = function (message) {
    sockets.forEach(function (socket) { return write(socket, message); });
};
var getLatestBlock = function () {
    blockchain[blockchain - 1];
};
var responseChainMsg = function () { return ({
    'type': JSON
}); };
var write = function (ws, message) { return ws.send(JSON.stringify(message)); };
var responseLatestMsg = function () { return ({
    'type': messageType.RESPONSE_BLOCKCHAIN,
    'data': JSON.stringify([getLatestBlock()])
}); };
var connectToPeers = function (newPeers) {
    newPeers.forEach(function (peer) {
        var ws = new WebSocket(peer);
        ws.on('open', function () { return initConnection(ws); });
        ws.on('error', function () { return console.log('connecton-failed'); });
    });
};
connectToPeers(initialPeers);
initHttpServer();
initP2PServer();
