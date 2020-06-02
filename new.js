var Fs=require('fs');
var Ws=require('ws');
var Https=require('https');

var authCons={};
var cons=[];
var games=[];
var consListMes={free: {}, not_free: {}};
var userMaxId=+Fs.readFileSync(__dirname+'/user_max_id', 'utf8');

var httpsServer = Https.createServer({key: Fs.readFileSync('/etc/ssl/certs/cert_tennis_thelv_ru.key', 'utf8'), cert: Fs.readFileSync('/etc/ssl/certs/cert_tennis_thelv_ru.crt', 'utf8')});
httpsServer.listen(8083);

const wsServer=new Ws.Server({server: httpsServer});
wsServer.on('connection', function(ws, req)
{
	console.log('new connection');
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
				con=cons[conId]=
				{
					id: conId,
					ws: ws,
					invitesFrom: {},
					invitesWho: {},														
					invitesClear: function()
					{
						for(var id in this.invitesWho)
						{
							var con_=cons[id];
							delete con_.invitesFrom[conId];
							con_.sendInvites();						
						}
						this.invitesWho={};
					},
					sendInvites: function()
					{					
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
					
						con.send({tp: 'invites', invites_from: invitesList(this.invitesFrom), invites_who: invitesList(this.invitesWho)});
					},
					send: function(mes)
					{
						if(con.offline) return; 				
						console.log('out:', mes, con.id);
						this.ws.send(JSON.stringify(mes), function(){});
					},
					sendEmpty: function()
					{
						this.ws.send('', function(){});
					},
					gameViewLeave: function()
					{
						delete con.gameView.viewers[conId];
						delete con.gameView;						
					}
				}
			}
			else
			{					
				con=cons[authCons[mes.auth]];				
				delete con.offline;
				
				if(! mes.reconnect)
				{
					con.send({tp: 'new_window_opened'})
					
					if(con.opponent)
					{					
						con.opponent.send({tp: 'game_stop'});
						con.game.stop();
					}
					
					if(con.gameView) con.gameViewLeave();							
				}
				
				con.ws=ws;
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

			sendConsLists();				
			con.sendInvites();
		}
		else
		{
			if(mes.g && con.opponent)
			{
				con.opponent.send(mes);
									
				var game=con.game;
				var gameState=game.state;						
				mes.side=con.side;
				switch(mes.tp)
				{
					case 'bh':						
						gameState.ball.h=mes;
						gameState.wait=0;
						break;
					
					case 'pcp':						
						con.player.cp=mes;
						break;
						
					case 'pcpa':
						con.player.cpa=mes;
						break;
					
					case 'rw':
						gameState.who_serve=! gameState.who_serve;
						gameState.wait=-1;
						game.score.change(con.side ? mes.w : ! mes.w);
						gameState.score=game.score.get();
						gameState.ball={};
						break;
					
					case 'wr':
						if(mes.t>0) gameState.wait=mes.t;
						break;
				}					
				
				for(var id in con.game.viewers)
				{
					cons[id].send(mes);
				}
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
						
						if(con.gameView) con.gameViewLeave();
						if(con_.gameView) con_.gameViewLeave();
						
						var t=new Date().getTime();
						con.send({tp: "game_create", first_serve: true, t: t, opponent: {id: con_.id, name: con_.name}});
						con_.send({tp: "game_create", first_serve: false, t: t, opponent: {id: conId, name: con.name}});
						
						var game=
						{
							id: games.length, 
							t: t,
							viewers: {},
							score: new Score(),
							state: {who_serve: false, wait: -1, players: [{}, {}], ball: {}},
							cons: [con, con_],								
							stop: function()
							{
								delete this.cons[0].opponent;	
								delete this.cons[1].opponent;
								
								for(var id in this.viewers)
								{
									cons[id].send({tp: 'game_stop'});
								}
								delete games[this.id];
							}
						}
						game.state.score=game.score.get();
						
						con.player=game.state.players[0];
						con.side=true;
						con_.player=game.state.players[1];
						con_.side=false;
						con.game=con_.game=game;
						
						games.push(game);
						
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
					con.game.stop();		
					sendConsLists();
					break;

				case 'game_view':		
					if(con.opponent) return;
					if(con.gameView) con.gameViewLeave();
					var game=games[mes.id];
					var con0=game.cons[0];
					var con1=game.cons[1];	
					con.gameView=game;
					con.send(
					{
						tp: "game_view", 
						t: game.t,
						players:
						[
							{
								id: con0.id, name: con0.name
							},
							{
								id: con1.id, name: con1.name
							}							
						],
						state: game.state,
					});						
					game.viewers[conId]=true;
					break;
					
				case 'game_view_leave':		
					if(con.gameView) con.gameViewLeave();
					con.send({tp: 'game_view_leave'});
					break;
					
				case 'chat':					
					sendToAll({tp: 'chat', id: conId, name: con.name, text: mes.text});
					break;
					
				default:
			}				
		}
	});
});

function sendConsLists()
{
	var free=[];
	//var notFree=[];
	for(var i in cons)
	{
		var con=cons[i];
		if(con.offline) continue;
		
		if(con.opponent)
		{			
			//notFree.push({id: con.id, name: con.name});
		}
		else
		{
			free.push({id: con.id, name: con.name});
		}
	}
	
	var games_=[];
	for(var i in games)
	{
		var game=games[i];
		
		games_.push({id: game.id, players:
		[
			{
				id: game.cons[0].id, name: game.cons[0].name
			},
			{
				id: game.cons[1].id, name: game.cons[1].name
			}							
		]});
	}
	
	for(var i in cons)
	{
		var con=cons[i];	
		con.send({tp: 'users', free: free, games: games_});
	}
}

function sendToAll(mes)
{
	for(var i in cons)
	{
		cons[i].send(mes);
	}
}

Score=function()
{
	var score = [[0, 0], [0, 0], [0, 0]];
	var scoreLimits = [7, 2];
	var scoreAdv = -1;
	var scoreInc = [0,-1];	
	
	this.get=function()
	{
		return score;
	}
		
	this.change=function(whoWin, type=0)
	{						
		var whoWinInt = whoWin ? 0 : 1;
		scoreInc = [type, whoWinInt];
		var notWhoWinInt = whoWin ? 1 : 0;
		var newScore = (score[type][whoWinInt] += 1)
		if (newScore > scoreLimits[type])			
		{
			if (type == 0 && score[type][notWhoWinInt] == scoreLimits[0])
			{
				score[type][whoWinInt] = scoreLimits[0];
				if (scoreAdv == whoWinInt)
				{						
					score[type] = [0, 0];
					this.change(whoWin, type + 1);
					scoreAdv = -1;
				}
				else if(scoreAdv==notWhoWinInt)
				{						
					scoreAdv = -1;
				}
				else
				{
					scoreAdv = whoWinInt;
				}				
			}
			else
			{
				score[type] = [0, 0];
				this.change(whoWin, type + 1);
			}
		}	

		if(whoWin)
		{	
			//waitView.status('success');
		}
		else
		{
			//waitView.status('fail');
		}						
		//advice.refresh();
	}
}
