let crypto = require('crypto');
let MutexPromise = require('mutex-promise');

module.exports = strapi => {
    //TODO Currently not secure since everyone can listen to all sockets
    //Check if user is authenticated and was allowed to make a get request before allowing the user to listeni
    return {
      initialize() {
        console.log(strapi)

        let setUpRealTimeAPI = new Promise(function(resolve, reject) { 
            setTimeout(async () =>{
                strapi.realTime = {}
                strapi.realTime.connectedSockets = {};
                //Only Call when you are sure this should be allowed;
                strapi.realTime.addListener = addListener;
                //Set Up API EndPointListener
                setUpStrapiApiCheck(strapi);
                let io = require('socket.io')(strapi.server);
                io.on('connection', (socket) => connectSocket(socket, strapi.realTime.connectedSockets));
                // io.on('reconnect', (socket) => {console.log("reconnect")});
            
                strapi.realTime.io = io; // register socket io inside strapi main object to use it globally anywhere
                resolve();
            }, 5000)
        });

        strapi.app.use(async (ctx, next) => {
            await setUpRealTimeAPI;
            let endPointData = getEndPointData(strapi, ctx);
            if (endPointData){
                //TODO Listener not very efficient
                await next();
                if (ctx.response.status != 200) return;
                if (ctx.method == "GET"){
                    if (endPointData.canListen && ctx.request.header.listen == "true" && ctx.request.header.userid){
                        //TODO Find a way to check if listener is using own socket userid
                        let socket = strapi.realTime.connectedSockets[ctx.request.header.userid];
                        if (socket) addListener(socket, ctx.path)
                    }
                }
                else if (ctx.method == "POST"){
                    if(listeners[endPointData.path]){
                        listeners[endPointData.path].forEach( socket => {
                            socket.emit('listen', {path:endPointData.path, val: ctx.request.body})
                        })
                    }
                }
                

            }
            else if (ctx.path != "/socket.io/"){
                await next();
            }
        });
      },
    };
};

async function addListener(socket, path){
    return new Promise(function(resolve, reject) {
        mutexListener.promise().then(() => {
            mutexListener.lock();
            if (listeners[path]){
                listeners[path].push(socket);
            }
            else{
                listeners[path] = [socket];
            }
        }).then( () => {
            mutexListener.unlock();
            socket.listenPaths.push(path);
            resolve()
        }).catch(function(e){
            mutexListener.unlock();
            reject(e)
        });
    })
}

async function connectSocket(socket, connectedSockets){
    socket.userID = await getSecureToken();
    connectedSockets[socket.userID] = socket;
    socket.listenPaths = [];
    socket.emit('init', {userID: socket.userID})
    socket.on('disconnect', () => {
        delete connectedSockets[socket.userID];
        socket.listenPaths.forEach( path => {
            mutexListener.promise().then(() => {
                mutexListener.lock();
                if (listeners[path]){
                    listeners[path].filter( listenPath => {
                        return listenPath != path;
                    });
                }
            }).then( () => {
                mutexListener.unlock();
            }).catch(function(e){
                mutexListener.unlock();
                throw e;
            });
        });
    });
}

let strapiAPIRoutes = [];
function setUpStrapiApiCheck(strapi){
    let stack = strapi.router.stack;
    let apis = strapi.api;
    let apiKeys = Object.keys(apis)
    for (let index = 0; index < apiKeys.length; index++) {
        let apiKey = apiKeys[index]
        let api = apis[apiKey]
        if (!api || !api.config || !api.config.routes) continue;
        let endPoints = api.config.routes;
        endPoints.forEach(endPoint => {
            let endPointInStack = stack.find( (stackPoint) => {
                return stackPoint.methods.includes(endPoint.method) && stackPoint.path === endPoint.path;
            })
            if (endPointInStack){
                if (endPoint.handler){
                    let handlerType = endPoint.handler.split(".")[1];
                    if (handlerType == "find") endPointInStack.canListen = true;
                }
                strapiAPIRoutes.push(endPointInStack)
            }
        });
    }
}

let mutexListener = new MutexPromise('listener');
let listeners = {};
function getEndPointData(strapi, ctx){
    let isApiEndpoint = strapiAPIRoutes.find( (apiPoint) => {
        let isMethod = apiPoint.methods.includes(ctx.method);
        let isPath = apiPoint.regexp.test(ctx.path);
        return isMethod && isPath;
    });
    return isApiEndpoint;
}

async function getSecureToken(){
    return new Promise(function(resolve, reject) {
        crypto.randomBytes(48, function(crypto_err, buffer) { 
            let token = buffer.toString('hex'); 
            resolve(token)
        })
    });
} 