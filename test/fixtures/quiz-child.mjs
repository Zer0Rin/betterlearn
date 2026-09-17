import { createServer } from 'node:http'
let sessions = 0
const server = createServer((req, res) => {
  res.setHeader('content-type', 'application/json')
  if (req.headers['x-betterlearn-host'] !== process.env.MANAGED_HOST_TOKEN) { res.writeHead(403).end('{}'); return }
  const send = data => res.end(JSON.stringify({code:0,message:'success',data}))
  if (req.url === '/api/v1/health') return send({status:'ok'})
  if (req.url === '/api/v1/user/host-session') return send({token:`jwt-${++sessions}`,user:{id:1,nickname:'test'}})
  if (req.url === '/api/v1/user/profile' && req.headers.authorization === 'Bearer jwt-1') {res.writeHead(401).end('{}'); return}
  if (req.url === '/api/v1/user/profile') return send({id:1,nickname:'renewed',sessions})
  if (req.url === '/api/v1/slow') return
  send({url:req.url,method:req.method})
})
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({betterlearnQuizPort:server.address().port})))
process.stdin.resume()
process.stdin.on('end',()=>server.close(()=>process.exit()))
