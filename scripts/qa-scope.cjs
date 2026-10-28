'use strict';
// A group for tank D contains the characters "D-", but it does not run
// multiplayer cases. Only launch an additional native EXE when the room case
// itself is within the requested QA scenario filter.
function needsNetworkClient(filter){
 return !filter||filter.test('D-LAN-create-join-start-sync-reconnect')||filter.test('D-dual-client-bootstrap');
}
module.exports={needsNetworkClient};
