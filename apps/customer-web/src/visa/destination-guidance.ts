import type { GuideDocument } from './visa-guide-content';

interface Source { label:string; url:string }
interface DestinationGuidance {
  visitor:Source; study:Source; visitorRoute:string; studyRoute:string;
  visitorDocuments:string; studyDocuments:string; arrival:Source & {instructions:string[]};
}
// Preparation guidance for ordinary Bangladeshi passport holders. Eligibility is
// never inferred from the availability of an e-Visa website or a Flyseri service.
export const destinationGuidance:Record<string,DestinationGuidance> = {
  TH:{
    visitor:{label:'Royal Thai Embassy · visa categories',url:'https://dhaka.thaiembassy.org/en/page/59898-visa-information'},
    study:{label:'Royal Thai Embassy · education visas',url:'https://dhaka.thaiembassy.org/en/page/59898-visa-information'},
    visitorRoute:'Choose the Thai visa category matching your visit. Follow the Thai e-Visa checklist for your nationality and the mission responsible for your place of residence.',
    studyRoute:'Study requires an appropriate education visa, such as Non-Immigrant ED or ED Plus where eligible. Ask your institution to confirm the category before applying.',
    visitorDocuments:'Prepare the Thai application checklist, current passport and previous passports where requested by the Dhaka mission, itinerary, accommodation and funding evidence. Follow the current e-Visa upload instructions.',
    studyDocuments:'Obtain admission and the supporting letters from your Thai educational institution. Confirm the institution approvals and any education-authority documents for the ED or ED Plus route.',
    arrival:{label:'Thailand Digital Arrival Card (TDAC)',url:'https://tdac.immigration.go.th/',instructions:['Complete TDAC within the three days before arrival if entering Thailand, unless an official exemption applies. Airside transit without passing immigration is exempt.','Use passport, journey, accommodation and health information. Save the confirmation. TDAC is free and does not replace a visa.']},
  },
  SG:{
    visitor:{label:'ICA · Bangladesh entry-visa checklist',url:'https://www.ica.gov.sg/enter-transit-depart/entering-singapore/visa_requirements/visa-detail-page/bangladesh'},
    study:{label:'ICA · Student’s Pass applications',url:'https://www.ica.gov.sg/reside/STP/apply'},
    visitorRoute:'Ordinary Bangladeshi passport holders need a Singapore entry visa. Apply through an eligible local contact, strategic partner, overseas mission or authorised visa agent.',
    studyRoute:'Full-time study generally requires a Student’s Pass. Your application route depends on the institution type; admission alone is not permission to study or enter.',
    visitorDocuments:'Prepare signed Form 14A, passport biodata copy valid at least six months from entry, a colour photo taken within three months and Form V39A (Letter of Introduction). Follow ICA’s local-contact and translation rules.',
    studyDocuments:'Prepare the institution’s registration or admission details, passport biodata, photograph and the personal, education and financial information requested by the applicable ICA Student’s Pass category. Follow any in-principle approval and issuance requirements.',
    arrival:{label:'ICA · SG Arrival Card',url:'https://www.ica.gov.sg/enter-transit-depart/entering-singapore/sg-arrival-card',instructions:['Submit the free SG Arrival Card with electronic health declaration within three days, including the arrival date, unless exempt. Airside transit without immigration clearance is exempt.','Use the official ICA service. The arrival card is separate from your visa or Student’s Pass. Keep the email address accessible for immigration notifications.']},
  },
  AE:{
    visitor:{label:'UAE Government · tourist visas',url:'https://u.ae/en/information-and-services/visa-and-emirates-id/tourist-visa'},
    study:{label:'UAE Government · residence for study',url:'https://u.ae/en/information-and-services/visa-and-emirates-id/residence-visas/residence-visa-for-studying-in-the-uae'},
    visitorRoute:'Confirm the appropriate UAE entry permit and sponsor with the issuing authority. A tourist-visa listing does not establish eligibility or approval for a Bangladeshi applicant.',
    studyRoute:'Study residence is a separate route from tourism. Confirm sponsorship and the entry-permit and residence stages with the UAE institution and the relevant immigration authority.',
    visitorDocuments:'Confirm the sponsor or issuing provider’s passport, photo, itinerary, accommodation, insurance and supporting-document checklist. Requirements and availability vary by permit and issuing emirate.',
    studyDocuments:'Prepare the admission or enrolment evidence and sponsor documents requested by your institution. Confirm the applicable medical, Emirates ID and residence formalities before travel.',
    arrival:{label:'UAE Government · visa information',url:'https://u.ae/en/information-and-services/visa-and-emirates-id/visa-information',instructions:['Verify the entry permit with its issuing authority and confirm its permitted entry window before departure. Do not assume visa on arrival is available for a Bangladeshi passport.','Check emirate-specific entry instructions and customs declarations. For study, carry the institution’s entry approval and follow its residence instructions.']},
  },
  IN:{
    visitor:{label:'Government of India · visa applications',url:'https://indianvisaonline.gov.in/'},
    study:{label:'Study in India · visa & FRRO',url:'https://www.studyinindia.gov.in/Onboarding-%26-FRRO'},
    visitorRoute:'Confirm the available visa category and submission arrangements with the Indian mission responsible for your application. Do not assume that a Bangladeshi passport qualifies for an e-Visa.',
    studyRoute:'Obtain admission to a recognised Indian institution and follow the appropriate student-visa route. Check institution and FRRO registration instructions for your course and visa.',
    visitorDocuments:'Use the mission’s category-specific checklist for your application form, passport, photograph, residence and purpose evidence. Confirm appointment and original-document requirements before submission.',
    studyDocuments:'Prepare proof of admission to a recognised full-time course and financial support. Obtain the institution’s student-registration details and any course-specific approvals requested for your visa.',
    arrival:{label:'Government of India · e-Arrival card',url:'https://indianvisaonline.gov.in/',instructions:['Use the official e-Arrival service within 72 hours before arrival where applicable, following the current Bureau of Immigration instructions. This registration does not grant a visa.','Carry your approved visa and purpose documents. Students should check FRRO registration obligations and deadlines on their visa and with the institution.']},
  },
  SA:{
    visitor:{label:'Saudi Ministry of Foreign Affairs · visa services',url:'https://visa.mofa.gov.sa/'},
    study:{label:'Saudi Ministry of Foreign Affairs · study visa',url:'https://www.mofa.gov.sa/en/eservices/Pages/svc90.aspx'},
    visitorRoute:'Choose the correct Saudi visit category and confirm eligibility with the mission or official visa platform. Tourism, family visits and religious travel have different conditions.',
    studyRoute:'The Saudi educational institution initiates the study-visa request through the official process. Confirm the approval and mission checklist with the institution before arranging entry.',
    visitorDocuments:'Prepare the application and passport documents required for your selected category. Family and business visits may require an approved invitation; confirm sponsor, insurance and purpose evidence with the mission.',
    studyDocuments:'Obtain the institution’s admission and approved study-visa request details. Confirm the Saudi mission’s academic, attestation, medical and other supporting-document requirements for your case.',
    arrival:{label:'Saudi official visa platform',url:'https://visa.mofa.gov.sa/',instructions:['Check your issued visa’s purpose, validity, entry conditions and insurance. Confirm any health or religious-travel permits separately; a visit visa is not a Hajj permit.','Carry the approved invitation or institution documents where applicable and follow current official arrival and customs instructions.']},
  },
  TR:{
    visitor:{label:'Türkiye MFA · nationality & visa rules',url:'https://www.mfa.gov.tr/visa-information-for-foreigners.en.mfa'},
    study:{label:'Türkiye MFA · study-visa route',url:'https://www.mfa.gov.tr/visa-information-for-foreigners.en.mfa'},
    visitorRoute:'Bangladeshi ordinary passport holders need a visa. Conditional e-Visa eligibility depends on supporting visas or residence permits and all criteria shown by the official portal; otherwise use the consular route.',
    studyRoute:'Türkiye’s e-Visa is for tourism or commerce, not study. Apply for the appropriate study visa through a Turkish embassy or consulate.',
    visitorDocuments:'For a conditional e-Visa, check Bangladesh and your passport type in the official portal and prepare every supporting document it requires. A consular application follows the mission’s separate checklist.',
    studyDocuments:'Obtain the Turkish institution’s admission letter and follow the mission’s study-visa checklist for funding, accommodation, insurance and supporting records. Confirm post-arrival residence arrangements with the institution.',
    arrival:{label:'Türkiye MFA · entry & passport rules',url:'https://www.mfa.gov.tr/visa-information-for-foreigners.en.mfa',instructions:['Carry the visa and the supporting visa or residence permit used for conditional e-Visa eligibility. Your passport must satisfy Türkiye’s validity rules.','Check the conditions printed on your visa. Students must follow the study and residence procedures advised by the institution and immigration authority.']},
  },
  CN:{
    visitor:{label:'Chinese Embassy in Bangladesh · category documents',url:'https://bd.china-embassy.gov.cn/eng/sghd/202509/t20250912_11707745.htm'},
    study:{label:'Chinese Embassy · X1 / X2 documents',url:'https://bd.china-embassy.gov.cn/eng/sghd/202509/t20250912_11707745.htm'},
    visitorRoute:'Use the Chinese visa category matching your purpose: L for tourism, M for commerce and the applicable Q or S category for family visits. Follow the Dhaka visa-centre process.',
    studyRoute:'X1 covers study longer than 180 days; X2 covers study of no more than 180 days. Confirm the category and study confirmation documents with your institution.',
    visitorDocuments:'For tourism, the Dhaka embassy lists a mainland travel-provider invitation, paid hotel booking, itinerary, return flights and bank evidence meeting its published funding requirement. Business and family categories have different invitation requirements.',
    studyDocuments:'For higher-education X1 applications, prepare JW201 or JW202 and the original admission letter, plus scholarship or self-funding evidence. Use the embassy’s current category table for X2 and school-level study.',
    arrival:{label:'National Immigration Administration · arrival card',url:'https://s.nia.gov.cn/ArrivalCardFillingPC/',instructions:['Foreign visitors can prepare the arrival card using the National Immigration Administration’s online service. Follow its exemption and completion instructions.','Carry your visa and purpose documents. For long-term study, confirm residence-permit and local-registration formalities with your institution.']},
  },
  JP:{
    visitor:{label:'Embassy of Japan · Bangladesh visa guidance',url:'https://www.bd.emb-japan.go.jp/itpr_en/visa.html'},
    study:{label:'Japan MOFA · student visa',url:'https://www.mofa.go.jp/j_info/visit/visa/long/visa6.html'},
    visitorRoute:'Prepare the Japanese visa category appropriate to your trip using the Bangladesh mission’s current application and submission instructions.',
    studyRoute:'Study requires the appropriate student status and visa. Your institution normally assists with the Certificate of Eligibility (COE); the COE does not itself replace the visa.',
    visitorDocuments:'Follow the Bangladesh mission’s current checklist for passport, application, photo, schedule of stay, financial evidence and any invitation or guarantee documents. Use the checklist matching your purpose.',
    studyDocuments:'Prepare your passport, visa application, photograph and Certificate of Eligibility where issued. Confirm additional admission, academic and financial records with the mission and institution.',
    arrival:{label:'Japan Digital Agency · Visit Japan Web',url:'https://www.digital.go.jp/en/policies/visit_japan_web',instructions:['Visit Japan Web lets you prepare immigration and customs information online. Save its arrival QR code if using the service; it is not a visa.','Carry your visa and supporting documents. Students should follow the landing-permission and residence-card instructions for their entry airport and status.']},
  },
  GB:{
    visitor:{label:'UK Government · visitor supporting documents',url:'https://www.gov.uk/government/publications/visitor-visa-guide-to-supporting-documents/guide-to-supporting-documents-visiting-the-uk'},
    study:{label:'UK Government · Student visa documents',url:'https://www.gov.uk/student-visa/documents-you-must-provide'},
    visitorRoute:'Use the appropriate UK visa route for your visit. Standard Visitor rules cover permitted tourism, family visits and some business activities; they do not permit general employment.',
    studyRoute:'The Student route requires a licensed sponsor and Confirmation of Acceptance for Studies (CAS). Some short courses use a different route; confirm this with your course provider.',
    visitorDocuments:'Prepare a valid travel document and evidence of your circumstances, funding and planned visit. Sponsor evidence depends on who pays. UK guidance does not require flight or hotel bookings as standard supporting evidence.',
    studyDocuments:'Prepare your passport and CAS, plus financial and English-language evidence where required. Check tuberculosis testing, ATAS, under-18 consent and translations for your circumstances.',
    arrival:{label:'UK Government · before travel',url:'https://www.gov.uk/uk-border-control/before-you-leave-for-the-uk',instructions:['Check that your passport is linked to your UKVI account if you hold an eVisa, and that your permission is valid for travel. Follow the official instructions for proving your immigration status.','Keep your accommodation and visit evidence available. Students should carry course and sponsor details and check their permission’s conditions.']},
  },
  ID:{
    visitor:{label:'Indonesia Immigration · visa categories',url:'https://evisa.imigrasi.go.id/'},
    study:{label:'Indonesia Immigration · study visa selection',url:'https://evisa.imigrasi.go.id/'},
    visitorRoute:'Check the Indonesian visa category and nationality eligibility before booking. Do not assume a Bangladeshi passport qualifies for visa on arrival or e-VOA.',
    studyRoute:'Ask your Indonesian institution to confirm and sponsor the appropriate education visa and stay-permit route. A tourist visa does not authorise a full study programme.',
    visitorDocuments:'Follow the selected category’s passport, photograph, funding, sponsor and itinerary requirements. Check whether the application needs a guarantor and approval before travel.',
    studyDocuments:'Prepare the admission letter and the institution’s sponsorship or guarantee documents, plus passport, photo and financial evidence required by the selected education-visa category.',
    arrival:{label:'Indonesia Immigration · All Indonesia',url:'https://allindonesia.imigrasi.go.id/',instructions:['Complete the All Indonesia passenger declaration for your arrival, following the official portal’s timing and entry-point instructions. It combines immigration, customs, health and quarantine declarations.','Save the confirmation and carry your approved visa. The declaration does not grant visa-on-arrival eligibility or replace an entry visa.']},
  },
  PK:{
    visitor:{label:'Pakistan Government · online visa categories',url:'https://visa.nadra.gov.pk/'},
    study:{label:'Pakistan Government · student-visa category',url:'https://visa.nadra.gov.pk/'},
    visitorRoute:'Select the relevant Pakistan visa category and check Bangladesh eligibility in the official online system. Confirm the required approval before departure.',
    studyRoute:'Use the student-visa category with your Pakistani institution’s support. Confirm the current admission, approvals and security-clearance requirements before submission.',
    visitorDocuments:'Prepare the passport, photo and purpose documents requested in the selected category. Hotel, host or business-invitation evidence depends on the application route.',
    studyDocuments:'Obtain the institution’s admission or acceptance letter and ask it to confirm the applicable sponsorship, NOC and approval documents. Follow the student-category checklist in the official portal.',
    arrival:{label:'Pakistan Government · visa & entry guidance',url:'https://visa.nadra.gov.pk/',instructions:['Carry the approved visa or travel authorisation required for your category, passport and host or institution contact details. Check the conditions on the approval before travel.','Confirm current entry-point and declaration instructions with the official authority. An online application receipt is not an entry approval.']},
  },
  LK:{
    visitor:{label:'Sri Lanka Immigration · ETA guidance',url:'https://www.eta.gov.lk/'},
    study:{label:'Sri Lanka Immigration · educational residence',url:'https://immigration.gov.lk/pages_e.php?id=18'},
    visitorRoute:'Follow Sri Lanka’s current ETA or visa instructions for Bangladeshi applicants. Obtain the applicable approval before travelling rather than assuming arrival eligibility.',
    studyRoute:'Study uses the educational residence process, with institution and authority recommendations. Confirm the correct entry approval before travelling; a tourist ETA is not a student residence visa.',
    visitorDocuments:'Prepare passport and journey details for the appropriate ETA or visa route. Keep the approval, return or onward itinerary and funding evidence ready for entry checks.',
    studyDocuments:'For university students, prepare the university letter, Ministry of Higher Education recommendation, passport and the required Health Protection Plan. Other educational categories have a separate checklist.',
    arrival:{label:'Sri Lanka Immigration · arrival card',url:'https://www.immigration.gov.lk/',instructions:['Check the Department of Immigration’s online arrival-card service and complete the applicable arrival information. Arrival registration is separate from ETA or visa approval.','Carry the required entry approval and supporting journey documents. Students should follow the pre-arranged entry and residence instructions from their institution.']},
  },
  LA:{
    visitor:{label:'Lao Government · e-Visa eligibility & entry points',url:'https://www.laoevisa.gov.la/info'},
    study:{label:'Lao Ministry of Foreign Affairs',url:'https://www.mofa.gov.la/'},
    visitorRoute:'Confirm Bangladesh eligibility and the permitted entry point before choosing the Lao e-Visa route. If your passport or purpose is not eligible, obtain the appropriate visa from the responsible Lao mission.',
    studyRoute:'Arrange the correct study permission through your Lao institution and the responsible mission. Do not use tourist e-Visa instructions as a student-visa checklist.',
    visitorDocuments:'If confirmed eligible for e-Visa, the portal requests a recent 4 × 6 cm photograph and the full passport biodata page including the machine-readable lines. Other routes follow the mission’s checklist.',
    studyDocuments:'Ask the institution and Lao mission for the current admission, sponsor and approval checklist. Prepare passport and academic evidence, but confirm the exact study requirements before uploading or paying.',
    arrival:{label:'Lao Government · arrival & approved entry points',url:'https://www.laoevisa.gov.la/info',instructions:['If travelling on an approved e-Visa, carry its approval letter and use one of the officially designated entry points. Check that the passport details match.','Confirm the current arrival-card or registration process for your border crossing with the Lao authority. Do not assume all crossings accept the same visa.']},
  },
  KH:{
    visitor:{label:'Cambodia Government · visa eligibility',url:'https://www.evisa.gov.kh/'},
    study:{label:'Cambodia Ministry of Foreign Affairs',url:'https://www.mfaic.gov.kh/'},
    visitorRoute:'Confirm the available Cambodian visa route for a Bangladeshi passport with the official authority. Do not assume the online tourist visa or visa on arrival is available.',
    studyRoute:'Confirm the appropriate entry visa and student-stay arrangements with your Cambodian institution and the responsible mission. Tourist-visa guidance is not a study checklist.',
    visitorDocuments:'Use the checklist for the visa route confirmed by the Cambodian authority, including passport, photograph and any invitation or supporting travel evidence it requests.',
    studyDocuments:'Obtain the institution’s admission and supporting letters. Ask the mission to confirm the exact entry-visa, sponsor and study-stay documents before applying.',
    arrival:{label:'Cambodia Government · e-Arrival',url:'https://www.arrival.gov.kh/',instructions:['Complete Cambodia e-Arrival within the seven days before arrival, following the official instructions for your entry point. Keep the confirmation ready.','The arrival declaration does not replace your visa. Verify Bangladesh visa eligibility separately and carry your approved entry documents.']},
  },
};

export function destinationPurposeSource(code:string,purpose:string) {
  const guide=destinationGuidance[code];
  return guide ? purpose==='Study' ? guide.study : guide.visitor : undefined;
}
export function destinationPurposeDocuments(code:string,purpose:string):GuideDocument[] {
  const guide=destinationGuidance[code];
  if(!guide)return [];
  if(purpose==='Study')return [
    {title:'Admission & study approval',condition:'Study route; confirm the institution checklist',paragraphs:[guide.studyDocuments]},
    {title:'Passport & visa application',paragraphs:['Prepare your Bangladeshi passport biodata page and the official application. Follow the study route’s passport validity, blank-page and original-document requirements.']},
    {title:'Photo',paragraphs:['Use the photo specifications published for this study application; tourist-visa photo rules may differ.']},
    {title:'Academic & financial evidence',condition:'As required by the study route',paragraphs:['Provide academic records, scholarship or sponsor evidence, and funds or language evidence requested by the institution and authority. Confirm translations and attestation before submission.']},
    {title:'Entry & post-arrival formalities',condition:'After approval',paragraphs:[guide.studyRoute,'Follow the institution’s instructions for accommodation, arrival, registration, medical checks and residence permission where applicable.']},
    {title:'Family & additional evidence',condition:'If applicable or requested',paragraphs:['For minors or dependants, confirm birth certificates, parental consent, relationship and guardian documents. Supply additional evidence requested for your individual case.']},
  ];
  const details=purpose==='Tourism' ? guide.visitorDocuments : purpose==='Business'
    ? 'Confirm the permitted business activities and obtain the destination-specific invitation, host-company and employer documents. Business visits do not automatically permit employment.'
    : 'Confirm the correct family-visit category. Prepare the host’s invitation, identity or residence evidence and documents proving your relationship as requested by the authority.';
  return [{title:purpose==='Tourism'?'Destination visa checklist':purpose==='Business'?'Business invitation & category':'Family invitation & relationship',condition:'Confirm the applicable route',paragraphs:[details]}];
}
