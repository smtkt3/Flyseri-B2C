import { VisaIcon } from './visa-discovery';

const mdacUrl = 'https://imigresen-online.imi.gov.my/mdac/main';

export function MalaysiaTravelRules({student=false}:{student?:boolean}) {
  return <>
    <h3 className="visa-reference-subheading"><VisaIcon name="documents"/> Before arrival · Digital Arrival Card</h3>
    <ul className="visa-reference-travel-list">
      <li>Bangladeshi visitors must complete the Malaysia Digital Arrival Card (MDAC), unless an official exemption applies.</li>
      <li><strong>Submit within the three days before arrival in Malaysia.</strong> This is a separate arrival registration; it does not replace your visa.</li>
      <li>Prepare your passport, travel dates and Malaysian accommodation details. Save your registration confirmation to show at immigration.</li>
      <li>Relevant exemptions include diplomatic or official passport holders, Malaysian permanent residents and Malaysian long-term pass holders. Check the official exemption list for your status.</li>
    </ul>
    <a className="visa-text-link" href={mdacUrl} target="_blank" rel="noreferrer">Complete the official MDAC form ↗</a>
    <h3 className="visa-reference-subheading"><VisaIcon name="plane"/> Before departure</h3>
    <ul className="visa-reference-travel-list">
      <li>{student ? 'Follow the passport requirements for your student-pass and entry-visa stages. Carry your passport, institution offer, approved eVAL and valid entry visa.' : 'Carry a passport valid for at least six months and your valid Malaysian visa. Check that the details match your passport.'}</li>
      <li>{student ? 'Confirm arrival arrangements and accommodation with your institution. Keep your boarding pass and the supporting documents listed on your approval ready.' : 'Keep your digital or printed e-Visa, boarding pass, confirmed return ticket where applicable, paid accommodation proof and financial supporting documents ready.'}</li>
      <li>Check airline and transit-country requirements for your route. Students should also follow their institution’s arrival and student-pass instructions.</li>
    </ul>
    <h3 className="visa-reference-subheading"><VisaIcon name="plane"/> On arrival</h3>
    <ul className="visa-reference-travel-list">
      <li>Show your MDAC registration, unless exempt, and present your passport and visa at the immigration counter.</li>
      <li>Provide your travel, accommodation and supporting documents when requested. A visa or completed MDAC does not guarantee entry.</li>
      <li>Check the stay permitted by immigration and leave before it expires. Visa validity is separate from your permitted stay.</li>
    </ul>
    {student && <><h3 className="visa-reference-subheading"><VisaIcon name="documents"/> After arrival · new students</h3><ul className="visa-reference-travel-list"><li>Attend medical screening at an EMGS panel clinic within seven working days of arrival.</li><li>Coordinate student-pass endorsement with your institution. EMGS cannot start endorsement without the required in-country screening.</li></ul><a className="visa-text-link" href="https://visa.educationmalaysia.gov.my/guidelines/medical-screening" target="_blank" rel="noreferrer">EMGS medical-screening requirements ↗</a></>}
    <p className="visa-reference-source-note">Official guidance: <a href={mdacUrl} target="_blank" rel="noreferrer">MDAC registration & exemptions ↗</a> · <a href="https://malaysiavisa.imi.gov.my/terms-and-conditions/" target="_blank" rel="noreferrer">MYVISA entry documents ↗</a><br/>Checked 18 October 2026. Recheck before travel.</p>
  </>;
}
