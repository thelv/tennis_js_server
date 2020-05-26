var Fs = require('fs');
var Ws=require('ws');

var authCons={};
var cons=[];
var games={};
var userMaxId=0;
var consListMes={free: {}, not_free: {}};

Fs.readFile('user_max_id', 'utf8', function(err, res) 
{
	userMaxId=+res;

	const wsServer=new Ws.Server({port: 8083});
	wsServer.on('connection', function(ws) 
	{				
		var con=conId=false;
	
		ws.on('close', function()
		{
			if(con) con.offline=true;
			sendConsLists();
		});
		
		ws.on('error', function(){});
		
		var conNotInited=true;
		ws.on('message', function(mes)
		{			
			console.log(mes);
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
				con.invitesClear=function()
				{
					for(var id in this.invitesWho)
					{
						var con_=cons[id];
						delete con_.invitesFrom[conId];
						con_.sendInvites();						
					}
				}
				con.sendInvites=function()
				{					
					//console.log('this:', this);
					con.send({tp: 'invites', invites_from: consOfflineClear(this.invitesFrom), invites_who: consOfflineClear(this.invitesWho)});
				}
				
				if(mes.name)
				{
					con.name=mes.name; 
				}
				else 
				{
					userMaxId++;
					Fs.writeFile('user_max_id', userMaxId, function(){});
					con.name='user'+userMaxId;
					con.send({tp: 'name_set', name: con.name});
				}	

				sendConsLists();				
			}
			else
			{
				if(mes.g)
				{
					con.opponent.send(mes);
					if(mes.tp=='bh') console.log('HEREEERERERER');
				}
				else switch(mes.tp)
				{					
					case 'name_set':				
						con.name=mes.name;
						sendConsLists();
						break;
						
					case 'invite_send':	
						if(con.opponent) return;
						
						var con_=cons[mes.id];
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
							con.send({tp: "game_create", first_serve: true, t: t});
							con_.send({tp: "game_create", first_serve: false, t: t});
							
							sendConsLists();
						}
						break;
						
					case 'invite_cancel':						
						delete invitesFrom[conId];
						delete con.invitesWho[mes.id];
						break;	

					case 'game_leave':
						delete con.opponent;
						delete con_.opponent;
						con_.send({tp: 'game_leave'});
						
						sendConsLists();
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
			console.log('conId: '+con.id);
			free.push({id: con.id, name: con.name});
		}
	}
	
	for(var i in cons)
	{
		var con=cons[i];		
		con.send({tp: 'users', free: free, not_free: notFree});
	}
}

function consOfflineClear(ids)
{
	var ids_=[];
	for(var id in ids)		
	{
		if(! cons[id].offline) ids_.push(id);
	}
	return ids_;
}
