import { VisaIcon } from './visa-discovery';
import { destinationGuidance, destinationPurposeSource } from './destination-guidance';

export function DestinationTravelRules({code,student}:{code:string;student:boolean}) {
  const guide=destinationGuidance[code];
  if(!guide)return null;
  const source=destinationPurposeSource(code,student?'Study':'Tourism')!;
  return <>
    <h3 className="visa-reference-subheading"><VisaIcon name="documents"/> Before arrival</h3>
    <ul className="visa-reference-travel-list">{guide.arrival.instructions.map(text=><li key={text}>{text}</li>)}</ul>
    <a className="visa-text-link" href={guide.arrival.url} target="_blank" rel="noreferrer">{guide.arrival.label} ↗</a>
    <h3 className="visa-reference-subheading"><VisaIcon name="plane"/> Before departure</h3>
    <ul className="visa-reference-travel-list">
      <li>{student?guide.studyRoute:guide.visitorRoute}</li>
      <li>Check passport validity and the details on your issued permission. Carry the approval and supporting documents required for your category.</li>
      <li>{student?'Confirm accommodation, arrival arrangements and registration instructions with your institution.':'Keep your accommodation or host details, travel itinerary and funding evidence available where requested.'}</li>
      <li>Check airline and transit-country requirements for every connection, especially if collecting baggage or passing immigration.</li>
    </ul>
    <h3 className="visa-reference-subheading"><VisaIcon name="plane"/> On arrival</h3>
    <ul className="visa-reference-travel-list"><li>Present your passport, required entry permission and any applicable arrival confirmation. Approval does not guarantee entry.</li><li>Check the stay granted by immigration and comply with the conditions. Visa validity and permitted stay are different.</li>{student&&<li>Complete the institution and immigration formalities for your study status; do not assume entry permission completes residence registration.</li>}</ul>
    <p className="visa-reference-source-note">Official guidance: <a href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a><br/>Reviewed 19 October 2026. Recheck eligibility, exemptions and requirements before travel.</p>
  </>;
}
