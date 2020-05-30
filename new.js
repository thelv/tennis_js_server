var Fs = require('fs');
var Ws=require('ws');

var authCons={};
var cons=[];
var games={};
var userMaxId=0;
var consListMes={free: {}, not_free: {}};
Fs.readFile(__dirname+'/user_max_id', 'utf8', function(err, res) 
{
	userMaxId=+res;
	const wsServer=new Ws.Server({port: 8083});
	wsServer.on('connection', function(ws, req) 
	{
		console.log('new connection');
		console.log(req.url+'');
		var con=false, conId=false;
	
		ws.on('close', function()
		{
			if(con) con.offline=true;
			sendConsLists();
			for(var id in con.invitesWho)
			{
				cons[id].sendInvites();
			}
		});
		
		ws.on('error', function(){});
		
		var conNotInited=true;
		ws.on('message', function(mes)
		{			
			console.log('in:', mes, con.id, conId);
			mes=JSON.parse(mes);
			if(conNotInited)
			{
				conNotInited=false;
				
				conId=authCons[mes.auth];
				if(! conId)
				{
					conId=cons.length || 1;					
					authCons[mes.auth]=conId;
					con=cons[conId]={id: conId, invitesFrom: {}, invitesWho: {}};										
													
					con.invitesClear=function()
					{
						for(var id in this.invitesWho)
						{
							var con_=cons[id];
							delete con_.invitesFrom[conId];
							con_.sendInvites();						
						}
						this.invitesWho={};
					}
					con.sendInvites=function()
					{					
						con.send({tp: 'invites', invites_from: invitesList(this.invitesFrom), invites_who: invitesList(this.invitesWho)});
					}
				}
				else
				{					
					con=cons[authCons[mes.auth]];					
					delete con.offline;
				}
				
				con.send=function(mes)
				{
					if(con.offline) return; 				
					console.log('out:', mes, con.id);
					ws.send(JSON.stringify(mes), function(){});
				};	

				con.sendEmpty=function()
				{
					ws.send('', function(){});
				}
				
				if(mes.name)
				{
					con.name=mes.name; 
				}
				else 
				{
					userMaxId++;
					Fs.writeFile(__dirname+'/user_max_id', userMaxId, function(){});
					con.name='user'+userMaxId;
					con.send({tp: 'name_set', name: con.name});
				}	
				
				if(! con.reconnect && con.opponent)
				{					
					con.opponent.send({tp: 'game_stop'});
					delete con.opponent.opponent;	
					delete con.opponent;					
				}

				sendConsLists();				
				con.sendInvites();
			}
			else
			{
				if(mes.g && con.opponent)
				{
					con.opponent.send(mes);
					//con.send({});
				}
				else switch(mes.tp)
				{					
					case 'name_set':				
						con.name=mes.name;
						sendConsLists();
						for(var id in con.invitesWho)
						{
							cons[id].sendInvites();
						}
						for(var id in con.invitesFrom)
						{
							cons[id].sendInvites();
						}
						break;
						
					case 'invite_send':	
						if(con.opponent || conId==mes.id) return;
						
						var con_=cons[mes.id];
						if(con_.offline) return;
						
						if(! con.invitesFrom[mes.id])
						{
							con_.invitesFrom[conId]=true;
							con.invitesWho[mes.id]=true;														
							con.sendInvites();
							con_.sendInvites();
						}
						else
						{
							if(con_.opponent) return;
							
							con.opponent=con_;
							con_.opponent=con;
							con.invitesClear();
							con_.invitesClear();
							con.sendInvites();
							con_.sendInvites();
							var t=new Date().getTime();
							con.send({tp: "game_create", first_serve: true, t: t, opponent: {id: con_.id, name: con_.name}});
							con_.send({tp: "game_create", first_serve: false, t: t, opponent: {id: conId, name: con.name}});
							
							sendConsLists();
						}
						break;
						
					case 'invite_cancel':						
						delete cons[mes.id].invitesFrom[conId];
						delete con.invitesWho[mes.id];
						con.sendInvites();
						cons[mes.id].sendInvites();
						break;	

					case 'game_leave':		
						if(! con.opponent) return;
						con.opponent.send({tp: 'game_stop'});
						con.send({tp: 'game_stop'});					
						delete con.opponent.opponent;	
						delete con.opponent;						
						
						sendConsLists();
						break;
						
					case 'chat':					
						sendToAll({tp: 'chat', id: conId, name: con.name, text: mes.text});
						break;
						
					default:
				}				
			}
		});
	});	
});

function sendConsLists()
{
	var free=[];
	var notFree=[];
	for(var i in cons)
	{
		var con=cons[i];
		if(con.offline) continue;
		
		if(con.opponent)
		{			
			notFree.push({id: con.id, name: con.name});
		}
		else
		{
			free.push({id: con.id, name: con.name});
		}
	}
	
	for(var i in cons)
	{
		var con=cons[i];		
		con.send({tp: 'users', free: free, not_free: notFree});
	}
}

function invitesList(ids)
{
	var invites=[];
	for(var id in ids)
	{
		var con=cons[id];
		if(! con.offline) invites.push({id: id, name: con.name});
	}
	return invites;
}

function sendToAll(mes)
{
	for(var i in cons)
	{
		cons[i].send(mes);
	}
}
