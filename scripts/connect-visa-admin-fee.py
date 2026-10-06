from pathlib import Path
root=Path('C:/Users/smtkt/Documents/ChatGPT/BOT/Whatsapp_CRM_Seri_Mechan')
(root/'components/b2c/visa-assistance-fee-panel.tsx').write_text(Path('scripts/visa-assistance-fee-panel.tsx').read_text(encoding='utf-8-sig'),encoding='utf-8')
p=root/'components/b2c/admin-workspace.tsx';s=p.read_text(encoding='utf-8');s=s.replace("import { IntegrationPanel }", "import { VisaAssistanceFeePanel } from './visa-assistance-fee-panel';\nimport { IntegrationPanel }");s=s.replace("    {section === 'integration'", "    {section === 'visa' && !detailId && (role === 'owner' || role === 'manager') && <VisaAssistanceFeePanel />}\n    {section === 'integration'");p.write_text(s,encoding='utf-8')
p=root/'app/api/b2c/[...path]/route.ts';s=p.read_text(encoding='utf-8');pos=s.index("  if (path.length === 4 && path[0] === 'crm-sync'");s=s[:pos]+'''  if (path.length === 2 && path[0] === 'visa' && path[1] === 'assistance-fee') {
    const origin = flyseriAdminOrigin(), token = signFlyseriAdminRequest(staff);
    if (!origin || !token) return NextResponse.json({error:'Flyseri administration is not connected.'},{status:503});
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return NextResponse.json({error:'Invalid fee settings.'},{status:400});
    try {
      const upstream = await fetch(new URL('/api/v1/admin/visa/assistance-fee', origin), {method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(8000)});
      return NextResponse.json(await upstream.json(), {status:upstream.status,headers:{'Cache-Control':'no-store'}});
    } catch { return NextResponse.json({error:'Fee settings are temporarily unavailable.'},{status:503}); }
  }
'''+s[pos:];p.write_text(s,encoding='utf-8')
