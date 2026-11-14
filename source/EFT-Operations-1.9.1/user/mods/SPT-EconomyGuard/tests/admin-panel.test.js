'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EconomyGuard } = require('../src/engine');
const { AdminPanelServer } = require('../src/admin-panel');
const { OperationsService } = require('../src/operations/service');
let root = null;
let panel = null;
let outsideZip = null;
(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-admin-'));
  const modDir = path.join(root,'user','mods','SPT-EconomyGuard'); fs.mkdirSync(path.join(modDir,'config'),{recursive:true}); fs.cpSync(path.join(__dirname,'..','web'),path.join(modDir,'web'),{recursive:true});
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
    {eventId:'event-profile-secret',type:'player_raid_end',groupId:'group-review-1',matchId:'fika-match-secret',profileId:'PROFILESECRET',displayName:'Alpha PMC',map:'woods',exitStatus:'Survived',exitName:'Outskirts',reportedVictimCount:1,reportedVictims:[{profileId:'VICTIMSECRET',name:'Scav-Test',role:'assault',side:'Savage',corroboratedByFikaDeathReport:true}],reportedLootItemCount:2,reportedLootByTpl:{'tpl-123':2},acceptedLootByTpl:{'tpl-123':2},reportedLootItems:[{itemId:'ITEMSECRET',tpl:'tpl-123',count:2,acceptedBySpt:true}],reportedSessionCounters:[{key:['KilledSavage'],value:1}],evidenceTrust:'untrusted_client_report',rewardEligible:false},
    {eventId:'death-profile-secret',type:'fika_player_died',groupId:'group-review-1',matchId:'fika-match-secret',profileId:'PROFILESECRET',reportedCharacterProfileId:'VICTIMSECRET',displayName:'Bravo PMC',evidenceTrust:'authenticated_client_report'},
    {eventId:'match-profile-secret',type:'fika_match_end',groupId:'group-review-1',matchId:'fika-match-secret',players:['PROFILESECRET'],displayName:'Alpha PMC',evidenceTrust:'fika_match_end_lifecycle_with_authenticated_roster'}
  ];
  const fikaOperationsAdapter={getStatus:()=>({detected:true,enabled:true,observerInstalled:true,hookState:'ready'}),getRecentEvents:()=>fikaEvents};
  panel=new AdminPanelServer(modDir,guard,{info(){},warn(){},error(){}},{enabled:true,host:'127.0.0.1',port:0},{saveServer,launcherController,operations,board,fikaOperationsAdapter});
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
  const noArchiveAuth=await fetch(`http://127.0.0.1:${port}/api/svm/archive-preview?archive=../outside.zip`,{headers:{Host:`127.0.0.1:${port}`}}); assert.strictEqual(noArchiveAuth.status,401,'SVM archive preview must require admin authentication');
  const opsHeaders={Host:`127.0.0.1:${port}`,Authorization:`Bearer ${panel.token}`,'Content-Type':'application/json'};
  outsideZip=path.join(path.dirname(root),path.basename(root)+'-outside.zip');
  fs.writeFileSync(outsideZip,'not-a-zip');
  const archiveTraversal=await fetch(`http://127.0.0.1:${port}/api/svm/archive-preview?archive=${encodeURIComponent('../'+path.basename(outsideZip))}`,{headers:opsHeaders});
  assert.strictEqual(archiveTraversal.status,400,'SVM archive preview must reject paths outside the SPT server root');
  const opsSave=await fetch(`http://127.0.0.1:${port}/api/operations/save`,{method:'POST',headers:opsHeaders,body:JSON.stringify({title:'API Test Mission',map:'woods',mode:'solo',minPlayers:1,maxPlayers:1,objectives:[{id:'kills',type:'kill',target:'scav',count:1},{id:'loot',type:'collect',target:'tpl-123',count:2},{id:'extract',type:'extract',count:1}],rewards:{points:75,roubles:1000,items:[]}})});
  assert.strictEqual(opsSave.status,200); const savedMission=(await opsSave.json()).mission;
  const opsPublish=await fetch(`http://127.0.0.1:${port}/api/operations/publish`,{method:'POST',headers:opsHeaders,body:JSON.stringify({id:savedMission.id})});
  assert.strictEqual(opsPublish.status,200); const published=(await opsPublish.json()).mission; assert.strictEqual(published.status,'published');
  assert.strictEqual(postedEvents.length,1); assert.strictEqual(postedEvents[0].kind,'event'); assert.strictEqual(published.announcementId,postedEvents[0].id);
  const opsClose=await fetch(`http://127.0.0.1:${port}/api/operations/close`,{method:'POST',headers:opsHeaders,body:JSON.stringify({id:savedMission.id})});
  assert.strictEqual(opsClose.status,200); assert.strictEqual(postedEvents[0].enabled,false,'closing a mission also disables its public Event');

  const reviewGroup={
    id:'group-review-1',missionId:savedMission.id,raidId:'fika-match-secret',leaderProfileId:'LEADERSECRET',
    state:'review',createdAt:'2026-11-09T20:00:00.000Z',finishedAt:'2026-11-09T20:05:00.000Z',
    members:[{profileId:'PROFILESECRET',scavProfileId:'SCAVSECRET',displayName:'Alpha PMC',ready:true,result:'review'}],
    progress:{kills:1,loot:2,extract:1},progressTrust:{kills:'host_attested',loot:'spt_accepted_client_delta',extract:'client_report_only'},progressByTrust:{kills:{host_attested:1},loot:{spt_accepted_client_delta:2},extract:{client_report_only:1}},evidenceEvents:[{eventId:'host-event-secret',type:'kill',profileId:'PROFILESECRET',target:'assault',targetCategory:'scav',victimProfileId:'BOTSECRET',victimRole:'assault',victimSide:'Savage',reporterProfileId:'PROFILESECRET',matchId:'fika-match-secret',evidenceTrust:'host_attested',timestamp:'2026-11-09T20:04:00.000Z'},{eventId:'loot-event-secret',type:'collect',profileId:'PROFILESECRET',amount:2,target:'tpl-123',source:'spt-server-adapter',evidenceTrust:'spt_accepted_client_delta',timestamp:'2026-11-09T20:04:30.000Z'}],
    reviewData:{requiredDone:false,aliveProfileIds:['PROFILESECRET'],extractedProfileIds:['PROFILESECRET'],memberLifecycle:[{eventId:'lifecycle-secret',type:'fika_player_death_confirmed',playerId:'PROFILESECRET',timestamp:'2026-11-09T20:04:45.000Z',evidenceTrust:'fika_server_accepted_client_event',source:'FikaMatchService.setPlayerDead'}],evidenceTrust:'untrusted_client_report',source:'fika-server-adapter',submittedAt:'2026-11-09T20:05:00.000Z'}
  };
  operations.state.groups.push(reviewGroup);
  operations.reviewQueue=()=>[reviewGroup];
  const reviewsResponse=await fetch(`http://127.0.0.1:${port}/api/operations/reviews`,{headers:opsHeaders});
  assert.strictEqual(reviewsResponse.status,200);
  const reviewRows=await reviewsResponse.json();
  assert.strictEqual(reviewRows[0].missionTitle,'API Test Mission');
  assert.strictEqual(reviewRows[0].members[0].reviewIndex,0,'admin review member indexes must be stable without exposing profile IDs');
  assert.strictEqual(reviewRows[0].objectiveEvidence[0].reportedCount,1);
  assert.strictEqual(reviewRows[0].objectiveEvidence[0].hostAttestedCount,1);
  assert.strictEqual(reviewRows[0].objectiveEvidence[0].evidenceCounts.host_attested,1);
  assert.strictEqual(reviewRows[0].objectiveEvidence[0].evidenceStatus,'host_attested_admin_review');
  assert.strictEqual(reviewRows[0].hostEvidence[0].killerName,'Alpha PMC');
  assert.strictEqual(reviewRows[0].objectiveEvidence[1].sptAcceptedCount,2);
  assert.strictEqual(reviewRows[0].objectiveEvidence[1].evidenceStatus,'spt_accepted_client_delta_review');
  assert.strictEqual(reviewRows[0].objectiveEvidence[2].clientReportedCount,1);
  assert.strictEqual(reviewRows[0].objectiveEvidence[2].evidenceStatus,'client_report_only');
  assert.strictEqual(reviewRows[0].reviewData.evidenceCount,2);
  assert.strictEqual(reviewRows[0].reviewData.memberLifecycle[0].displayName,'Alpha PMC',
    'admin review should expose lifecycle evidence with a display name, not a private profile ID');
  assert.strictEqual(reviewRows[0].reviewData.memberLifecycle[0].evidenceTrust,'fika_server_accepted_client_event');
  const safeReviewJson=JSON.stringify(reviewRows);
  for(const secret of ['PROFILESECRET','VICTIMSECRET','SCAVSECRET','ITEMSECRET','fika-match-secret','LEADERSECRET','BOTSECRET','host-event-secret','loot-event-secret'])
    assert.ok(!safeReviewJson.includes(secret),`review API must not expose internal identifier ${secret}`);
  assert.strictEqual(reviewRows[0].fikaEvidence[0].reportedVictims[0].name,'Scav-Test');

  profiles['session-leaderboard']={info:{id:'session-leaderboard',username:'alpha'},characters:{pmc:{_id:profileId,Info:{Nickname:'Alpha PMC'}},scav:{_id:'abcdef0123456789abcdef98',Info:{Nickname:'Alpha Scav'}}}};
  operations.state.playerStats[profileId]={points:500,completedMissions:1};
  const leaderboardResponse=await fetch(`http://127.0.0.1:${port}/api/operations/leaderboard`,{headers:opsHeaders});
  assert.strictEqual(leaderboardResponse.status,200);
  const leaderboardRows=await leaderboardResponse.json();
  assert.strictEqual(leaderboardRows[0].displayName,'Alpha PMC');
  assert.ok(!JSON.stringify(leaderboardRows).includes(profileId),'leaderboard API must not expose profile IDs');

  operations.state.groups.push({id:'GROUPSECRET',missionId:savedMission.id,members:[{profileId:'AWARDPROFILESECRET',displayName:'Alpha PMC'}]});
  operations.state.awards.push({id:'award-test-1',key:'award-test-key',missionId:savedMission.id,groupId:'GROUPSECRET',profileId:'AWARDPROFILESECRET',points:75,roubles:1000,items:[],createdAt:'2026-11-09T20:06:00.000Z',status:'pending_delivery'});
  const awardsResponse=await fetch(`http://127.0.0.1:${port}/api/operations/awards`,{headers:opsHeaders});
  assert.strictEqual(awardsResponse.status,200);
  const awardRows=await awardsResponse.json();
  assert.strictEqual(awardRows[0].displayName,'Alpha PMC');
  const safeAwardsJson=JSON.stringify(awardRows);
  for(const secret of ['AWARDPROFILESECRET','GROUPSECRET','0123456789abcdef01234567'])
    assert.ok(!safeAwardsJson.includes(secret),`award API must not expose internal identifier ${secret}`);

  const fikaResponse=await fetch(`http://127.0.0.1:${port}/api/operations/fika`,{headers:opsHeaders});
  assert.strictEqual(fikaResponse.status,200);
  const safeFikaJson=JSON.stringify(await fikaResponse.json());
  for(const secret of ['PROFILESECRET','VICTIMSECRET','SCAVSECRET','ITEMSECRET','fika-match-secret'])
    assert.ok(!safeFikaJson.includes(secret),`Fika API must not expose internal identifier ${secret}`);

  const incompleteReview=await fetch(`http://127.0.0.1:${port}/api/operations/review`,{method:'POST',headers:opsHeaders,body:JSON.stringify({groupId:'group-review-1',decision:'approve',note:'Manual check attempted',attestation:{confirmed:true}})});
  assert.strictEqual(incompleteReview.status,400,'a generic confirmation must not approve a mission');
  assert.strictEqual((await incompleteReview.json()).error,'REVIEW_OBJECTIVES_NOT_CONFIRMED');
  const emptyEvidenceReview=await fetch(`http://127.0.0.1:${port}/api/operations/review`,{method:'POST',headers:opsHeaders,body:JSON.stringify({
    groupId:'group-review-1',decision:'approve',note:'Reference validation negative test',
    attestation:{confirmed:true,confirmedObjectiveIds:['kills','loot','extract'],confirmedMemberIndexes:[0],
      objectiveEvidenceRefs:{kills:'   ',loot:'SPT profile snapshot #L-2',extract:'raid outcome record #E-1'},
      memberEvidenceRefs:{'0':'operator outcome record #M-1'}}
  })});
  assert.strictEqual(emptyEvidenceReview.status,400,'blank per-objective evidence references must be rejected');
  assert.strictEqual((await emptyEvidenceReview.json()).error,'INVALID_REVIEW_OBJECTIVE_EVIDENCE_REF');
  const missingMemberOutcomeReview=await fetch(`http://127.0.0.1:${port}/api/operations/review`,{method:'POST',headers:opsHeaders,body:JSON.stringify({
    groupId:'group-review-1',decision:'approve',note:'Missing individual outcome negative test',
    attestation:{confirmed:true,confirmedObjectiveIds:['kills','loot','extract'],confirmedMemberIndexes:[0],
      objectiveEvidenceRefs:{kills:'admin case #K-17',loot:'SPT profile snapshot #L-2',extract:'raid outcome record #E-1'},
      memberEvidenceRefs:{'0':'operator outcome record #M-1'}}
  })});
  assert.strictEqual(missingMemberOutcomeReview.status,400,'per-member outcome is mandatory');
  assert.strictEqual((await missingMemberOutcomeReview.json()).error,'REVIEW_MEMBER_OUTCOMES_REQUIRED');
  const checklistReview=await fetch(`http://127.0.0.1:${port}/api/operations/review`,{method:'POST',headers:opsHeaders,body:JSON.stringify({
    groupId:'group-review-1',decision:'approve',note:'Reviewed objective evidence and member raid result',
    attestation:{confirmed:true,confirmedObjectiveIds:['kills','loot','extract'],confirmedMemberIndexes:[0],
      objectiveEvidenceRefs:{kills:'admin case #K-17',loot:'SPT profile snapshot #L-2',extract:'raid outcome record #E-1'},
      memberEvidenceRefs:{'0':'operator outcome record #M-1'},memberOutcomes:{'0':'success'}}
  })});
  const checklistReviewText=await checklistReview.text();
  assert.strictEqual(checklistReview.status,200,checklistReviewText);
  const checklistResult=JSON.parse(checklistReviewText);
  assert.strictEqual(checklistResult.group.review.attestationMethod,'admin_review_checklist');
  assert.deepStrictEqual(checklistResult.group.review.confirmedObjectiveIds,['kills','loot','extract']);
  assert.deepStrictEqual(checklistResult.group.review.confirmedMemberIndexes,[0]);
  assert.deepStrictEqual(checklistResult.group.review.memberOutcomes,[{memberIndex:0,result:'success',evidenceRef:'operator outcome record #M-1'}]);
  assert.deepStrictEqual(checklistResult.group.review.successfulMemberIndexes,[0]);
  assert.strictEqual(operations.state.awards.filter(x=>x.groupId==='group-review-1').length,1,'approval creates the idempotent member award only after checklist validation');

  // A squad review must award only successful members, never the whole group.
  const mixedGroup={
    id:'group-mixed-outcomes',missionId:savedMission.id,raidId:'mixed-match-secret',state:'review',
    members:[
      {profileId:'111111111111111111111111',displayName:'Successful Operator',result:'review'},
      {profileId:'222222222222222222222222',displayName:'Failed Operator',result:'review'}
    ],
    progress:{kills:1,loot:2,extract:1}
  };
  operations.state.groups.push(mixedGroup);
  const mixedReview=operations.resolveReview('group-mixed-outcomes','approve','Individual squad outcome verification','ADMIN',{
    confirmed:true,
    confirmedObjectiveIds:['kills','loot','extract'],
    confirmedMemberIndexes:[0,1],
    objectiveEvidenceRefs:{kills:'case #K-20',loot:'profile snapshot #L-20',extract:'raid record #E-20'},
    memberEvidenceRefs:{'0':'member #M-20 success','1':'member #M-21 failed'},
    memberOutcomes:{'0':'success','1':'failed'}
  });
  assert.strictEqual(mixedReview.members[0].result,'success');
  assert.strictEqual(mixedReview.members[1].result,'failed');
  assert.strictEqual(mixedReview.review.successfulMemberIndexes.join(','),'0');
  assert.strictEqual(mixedReview.review.failedMemberIndexes.join(','),'1');
  const mixedAwards=operations.state.awards.filter(x=>x.groupId==='group-mixed-outcomes');
  assert.strictEqual(mixedAwards.length,1,'only the successful member receives an award');
  assert.strictEqual(mixedAwards[0].profileId,'111111111111111111111111');
  assert.strictEqual(operations.state.playerStats['111111111111111111111111'].points,75);
  assert.strictEqual(operations.state.playerStats['222222222222222222222222'],undefined,'failed member receives no points');
  assert.strictEqual(operations.award(savedMission,mixedGroup,'111111111111111111111111'),false,'award ledger prevents duplicate member rewards');

  operations.state.groups.push({
    id:'history-group-secret',missionId:savedMission.id,raidId:'history-match-secret',state:'completed',
    members:[{profileId:'HISTORYPROFILESECRET',scavProfileId:'HISTORYSCAVSECRET',displayName:'Bravo PMC',result:'failed'}],
    review:{decision:'approve',note:'One operator did not extract',reviewer:'ADMIN',reviewedAt:'2026-11-13T01:00:00.000Z',
      attestationMethod:'admin_review_checklist',
      memberOutcomes:[{memberIndex:0,result:'failed',evidenceRef:'operator outcome record #R-2'}],
      objectiveEvidenceRefs:{kills:'admin case #K-2'}}
  });
  const historyResponse=await fetch(`http://127.0.0.1:${port}/api/operations/review-history`,{headers:opsHeaders});
  assert.strictEqual(historyResponse.status,200);
  const historyRows=await historyResponse.json();
  const approvedHistory=historyRows.find(row=>row.missionTitle==='API Test Mission' && row.members.some(member=>member.displayName==='Alpha PMC'));
  assert.ok(approvedHistory,'completed admin reviews remain visible after leaving the pending queue');
  assert.strictEqual(approvedHistory.decision,'approved');
  assert.deepStrictEqual(approvedHistory.members[0],{displayName:'Alpha PMC',result:'success',evidenceRef:'operator outcome record #M-1'});
  const deniedMemberHistory=historyRows.find(row=>row.members.some(member=>member.displayName==='Bravo PMC'));
  assert.ok(deniedMemberHistory);
  assert.strictEqual(deniedMemberHistory.members[0].result,'failed','failed operators remain in review history without an award row');
  assert.strictEqual(deniedMemberHistory.members[0].evidenceRef,'operator outcome record #R-2');
  const safeReviewHistory=JSON.stringify(historyRows);
  for(const secret of ['PROFILESECRET','SCAVSECRET','history-group-secret','history-match-secret','HISTORYPROFILESECRET','HISTORYSCAVSECRET','GROUPSECRET','AWARDPROFILESECRET'])
    assert.ok(!safeReviewHistory.includes(secret),`review history must not expose private identifier ${secret}`);
  const bad=await fetch(`http://127.0.0.1:${port}/api/health`,{headers:{Host:`127.0.0.1:${port}`,Authorization:'Bearer bad'}});
  assert.strictEqual(bad.status,401);
  await new Promise(resolve=>panel.server.close(resolve));
  fs.rmSync(root,{recursive:true,force:true});
  fs.rmSync(outsideZip,{force:true});
  console.log('PASS admin panel auth, account provisioning, ban controls, local API, blocklists and config updates');
})().catch(async err=>{
  console.error(err);
  try {
    if (panel && panel.server && panel.server.listening) {
      await new Promise(resolve=>panel.server.close(resolve));
    }
  } catch (_) { /* preserve the original assertion error */ }
  try { if (root) fs.rmSync(root,{recursive:true,force:true}); } catch (_) {}
  try { if (outsideZip) fs.rmSync(outsideZip,{force:true}); } catch (_) {}
  process.exitCode=1;
});
