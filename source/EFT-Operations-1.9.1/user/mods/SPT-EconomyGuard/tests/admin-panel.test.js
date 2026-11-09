'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EconomyGuard } = require('../src/engine');
const { AdminPanelServer } = require('../src/admin-panel');
const { OperationsService } = require('../src/operations/service');
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-admin-'));
  const modDir = path.join(root,'mod'); fs.mkdirSync(path.join(modDir,'config'),{recursive:true}); fs.cpSync(path.join(__dirname,'..','web'),path.join(modDir,'web'),{recursive:true});
  const cfg={enabled:true,mode:'audit',dataDirectory:path.join(root,'data'),restrictions:{enabled:true},storage:{caseRetentionDays:90},notifications:{enabled:true,prefix:'WATCH',separator:'\\n',messages:{}},price:{maxOvervalueRatio:20},flea:{maxTrackedEventsInMemory:100}};
  fs.writeFileSync(path.join(modDir,'config','config.json'),JSON.stringify(cfg,null,2));
  const provisionedId='fedcba9876543210fedcba98';
  const profiles={};
  const saveServer={getProfiles:()=>profiles,getProfile:id=>profiles[id]};
  const launcherController={connect:()=>({editions:['Standard']}),register:async info=>{profiles[provisionedId]={info:{id:provisionedId,username:info.username,password:info.password,edition:info.edition},characters:{pmc:{Info:{Nickname:''}}}};return provisionedId;}};
  const guard=new EconomyGuard(modDir,cfg,{info(){},warn(){},error(){}},{saveServer,launcherController});
  const operations = new OperationsService(path.join(root,'data'),{info(){},warn(){}});
  const postedEvents=[];
  const board={store:{listNews:()=>postedEvents},saveNews(item){if(item.id){const i=postedEvents.findIndex(x=>x.id===item.id);if(i<0)throw new Error('NEWS_NOT_FOUND');postedEvents[i]={...postedEvents[i],...item};return postedEvents[i];}const event={...item,id:`event-${postedEvents.length+1}`};postedEvents.push(event);return event;},deleteNews(id){const i=postedEvents.findIndex(x=>x.id===id);if(i>=0)postedEvents.splice(i,1);}};
  const fikaEvents=[
    {eventId:'event-profile-secret',type:'player_raid_end',groupId:'group-review-1',matchId:'fika-match-secret',profileId:'PROFILESECRET',displayName:'Alpha PMC',map:'woods',exitStatus:'Survived',exitName:'Outskirts',reportedVictimCount:1,reportedVictims:[{profileId:'VICTIMSECRET',name:'Scav-Test',role:'assault',side:'Savage',corroboratedByFikaDeathReport:true}],reportedLootItemCount:2,reportedLootByTpl:{'tpl-123':2},reportedLootItems:[{itemId:'ITEMSECRET',tpl:'tpl-123',count:2,acceptedBySpt:true}],reportedSessionCounters:[{key:['KilledSavage'],value:1}],evidenceTrust:'untrusted_client_report',rewardEligible:false},
    {eventId:'death-profile-secret',type:'fika_player_died',groupId:'group-review-1',matchId:'fika-match-secret',profileId:'PROFILESECRET',reportedCharacterProfileId:'VICTIMSECRET',displayName:'Bravo PMC',evidenceTrust:'authenticated_client_report'},
    {eventId:'match-profile-secret',type:'fika_match_end',groupId:'group-review-1',matchId:'fika-match-secret',players:['PROFILESECRET'],displayName:'Alpha PMC',evidenceTrust:'fika_match_end_lifecycle_with_authenticated_roster'}
  ];
  const fikaOperationsAdapter={getStatus:()=>({detected:true,enabled:true,observerInstalled:true,hookState:'ready'}),getRecentEvents:()=>fikaEvents};
  const panel=new AdminPanelServer(modDir,guard,{info(){},warn(){},error(){}},{enabled:true,host:'127.0.0.1',port:0},{saveServer,launcherController,operations,board,fikaOperationsAdapter});
  assert.match(panel.token,/^[a-f0-9]{64}$/i);
  const profileId='0123456789abcdef01234567',tpl='5e81f423763d9f754677bf2e';
  const created=await panel.createServerAccount({username:'friend_new',password:'StrongPassword123!',edition:'Standard'});
  assert.strictEqual(created.profileId,provisionedId);
  assert.strictEqual(guard.accessControl.getLoginDecision(provisionedId).allowed,true);
  panel.banAccount({profileId:provisionedId,reason:'test ban'});
  assert.strictEqual(guard.accessControl.getLoginDecision(provisionedId).code,'ACCOUNT_BANNED');
  panel.unbanAccount(provisionedId);
  assert.strictEqual(guard.accessControl.getLoginDecision(provisionedId).allowed,true);
  panel.addPlayerBlock({profileId,blocked:true,expiresAt:null,reason:'manual'});
  assert.strictEqual(guard.checkPlayerPurchasePolicy({_id:profileId},tpl,1,'trader-money','trader',profileId).reason,'PLAYER_BLOCKLISTED');
  panel.addItemBlock({tpl,blocked:true,expiresAt:null,channels:['any'],reason:'buggy item'});
  assert.strictEqual(guard.checkPlayerPurchasePolicy({_id:'abcdef0123456789abcdef01'},tpl,1,'flea-money',null,'abcdef0123456789abcdef01').reason,'ITEM_BLOCKLISTED');
  const rule=panel.addPlayerRule({profileId,tpl,channel:'trader-barter',block:true,reason:'barter exploit'});
  assert.ok(rule.ruleId);
  assert.strictEqual(panel.removePlayerRule(profileId,rule.ruleId),true);
  panel.removePlayerBlock(profileId);
  assert.strictEqual(guard.checkPlayerPurchasePolicy({_id:profileId},'5f0000000000000000000000',1,'trader-money','trader',profileId).valid,true,'player full block was removed');
  assert.strictEqual(guard.checkPlayerPurchasePolicy({_id:profileId},tpl,1,'trader-money','trader',profileId).valid,false,'the global item block remains active after player unblock');
  const saved=panel.saveConfigPatch({mode:'protect',notifications:{prefix:'BRONSON IS WATCHING',separator:'\\n',messages:{default:'Custom fallback text',PLAYER_BLOCKLISTED:'Purchase denied.'}},price:{maxOvervalueRatio:25}});
  assert.strictEqual(saved.mode,'protect'); assert.strictEqual(guard.config.mode,'protect'); assert.strictEqual(saved.notifications.messages.default,'Custom fallback text'); assert.strictEqual(saved.notifications.messages.PLAYER_BLOCKLISTED,'Purchase denied.');
  const externalPanel=new AdminPanelServer(modDir,guard,{info(){},warn(){},error(){}},{enabled:true,host:'0.0.0.0',port:6971});
  assert.strictEqual(externalPanel.start(),false,'Admin panel must refuse non-loopback binding');
  let serverError;
  panel.start();
  panel.server.on('error',e=>serverError=e);
  await new Promise(r=>setTimeout(r,80));
  if(serverError) throw serverError;
  const port=panel.server.address().port;
  const health=await fetch(`http://127.0.0.1:${port}/api/health`,{headers:{Host:`127.0.0.1:${port}`,Authorization:`Bearer ${panel.token}`}});
  assert.strictEqual(health.status,200);
  const accessResponse=await fetch(`http://127.0.0.1:${port}/api/access`,{headers:{Host:`127.0.0.1:${port}`,Authorization:`Bearer ${panel.token}`}});
  assert.strictEqual(accessResponse.status,200);
  const accessData=await accessResponse.json();
  assert.ok(accessData.accounts.some(a=>a.profileId===provisionedId),'panel API exposes the newly provisioned account'); const panelHtml=await fetch(`http://127.0.0.1:${port}/`,{headers:{Host:`127.0.0.1:${port}`}}); const csp=panelHtml.headers.get('content-security-policy')||''; assert.ok(csp.includes("style-src 'self' 'unsafe-inline'"),'CSP must allow the panel progress-bar style attributes while keeping scripts self-only');
  const opsPage=await fetch(`http://127.0.0.1:${port}/operations-admin.js`,{headers:{Host:`127.0.0.1:${port}`}});
  const opsText=await opsPage.text(); assert.strictEqual(opsPage.status,200,opsText); assert.match(opsText,/EFT Operations/);
  const noOpsAuth=await fetch(`http://127.0.0.1:${port}/api/operations`,{headers:{Host:`127.0.0.1:${port}`}}); assert.strictEqual(noOpsAuth.status,401);
  const opsHeaders={Host:`127.0.0.1:${port}`,Authorization:`Bearer ${panel.token}`,'Content-Type':'application/json'};
  const opsSave=await fetch(`http://127.0.0.1:${port}/api/operations/save`,{method:'POST',headers:opsHeaders,body:JSON.stringify({title:'API Test Mission',map:'woods',mode:'solo',minPlayers:1,maxPlayers:1,objectives:[{id:'extract',type:'extract',count:1}],rewards:{points:75,roubles:1000,items:[]}})});
  assert.strictEqual(opsSave.status,200); const savedMission=(await opsSave.json()).mission;
  const opsPublish=await fetch(`http://127.0.0.1:${port}/api/operations/publish`,{method:'POST',headers:opsHeaders,body:JSON.stringify({id:savedMission.id})});
  assert.strictEqual(opsPublish.status,200); const published=(await opsPublish.json()).mission; assert.strictEqual(published.status,'published');
  assert.strictEqual(postedEvents.length,1); assert.strictEqual(postedEvents[0].kind,'event'); assert.strictEqual(published.announcementId,postedEvents[0].id);
  const opsClose=await fetch(`http://127.0.0.1:${port}/api/operations/close`,{method:'POST',headers:opsHeaders,body:JSON.stringify({id:savedMission.id})});
  assert.strictEqual(opsClose.status,200); assert.strictEqual(postedEvents[0].enabled,false,'closing a mission also disables its public Event');

  operations.reviewQueue=()=>[{
    id:'group-review-1',missionId:savedMission.id,raidId:'fika-match-secret',leaderProfileId:'LEADERSECRET',
    state:'review',createdAt:'2026-11-09T20:00:00.000Z',finishedAt:'2026-11-09T20:05:00.000Z',
    members:[{profileId:'PROFILESECRET',scavProfileId:'SCAVSECRET',displayName:'Alpha PMC',ready:true}],
    progress:{},reviewData:{requiredDone:false,aliveProfileIds:['PROFILESECRET'],extractedProfileIds:['PROFILESECRET'],evidenceTrust:'untrusted_client_report',source:'fika-server-adapter',submittedAt:'2026-11-09T20:05:00.000Z'}
  }];
  const reviewsResponse=await fetch(`http://127.0.0.1:${port}/api/operations/reviews`,{headers:opsHeaders});
  assert.strictEqual(reviewsResponse.status,200);
  const reviewRows=await reviewsResponse.json();
  assert.strictEqual(reviewRows[0].missionTitle,'API Test Mission');
  assert.strictEqual(reviewRows[0].objectiveEvidence[0].reportedCount,1);
  assert.strictEqual(reviewRows[0].objectiveEvidence[0].evidenceStatus,'client_report_only');
  const safeReviewJson=JSON.stringify(reviewRows);
  for(const secret of ['PROFILESECRET','VICTIMSECRET','SCAVSECRET','ITEMSECRET','fika-match-secret','LEADERSECRET'])
    assert.ok(!safeReviewJson.includes(secret),`review API must not expose internal identifier ${secret}`);
  assert.strictEqual(reviewRows[0].fikaEvidence[0].reportedVictims[0].name,'Scav-Test');

  profiles['session-leaderboard']={info:{id:'session-leaderboard',username:'alpha'},characters:{pmc:{_id:profileId,Info:{Nickname:'Alpha PMC'}},scav:{_id:'abcdef0123456789abcdef98',Info:{Nickname:'Alpha Scav'}}}};
  operations.state.playerStats[profileId]={points:500,completedMissions:1};
  const leaderboardResponse=await fetch(`http://127.0.0.1:${port}/api/operations/leaderboard`,{headers:opsHeaders});
  assert.strictEqual(leaderboardResponse.status,200);
  const leaderboardRows=await leaderboardResponse.json();
  assert.strictEqual(leaderboardRows[0].displayName,'Alpha PMC');
  assert.ok(!JSON.stringify(leaderboardRows).includes(profileId),'leaderboard API must not expose profile IDs');

  const fikaResponse=await fetch(`http://127.0.0.1:${port}/api/operations/fika`,{headers:opsHeaders});
  assert.strictEqual(fikaResponse.status,200);
  const safeFikaJson=JSON.stringify(await fikaResponse.json());
  for(const secret of ['PROFILESECRET','VICTIMSECRET','SCAVSECRET','ITEMSECRET','fika-match-secret'])
    assert.ok(!safeFikaJson.includes(secret),`Fika API must not expose internal identifier ${secret}`);

  const bad=await fetch(`http://127.0.0.1:${port}/api/health`,{headers:{Host:`127.0.0.1:${port}`,Authorization:'Bearer bad'}});
  assert.strictEqual(bad.status,401);
  await new Promise(resolve=>panel.server.close(resolve));
  fs.rmSync(root,{recursive:true,force:true});
  console.log('PASS admin panel auth, account provisioning, ban controls, local API, blocklists and config updates');
})().catch(err=>{console.error(err);process.exitCode=1;});
