// Tipuri comune SmartQueue. Toți membrii echipei importă de aici.
// Dacă schimbați ceva aici, anunțați echipa: toate modulele depind de acest fișier.

// ---------- Profiluri de accesibilitate ----------
export type AccessibilityProfile =
  | 'standard'
  | 'wheelchair'   // scaun cu rotile: fără scări și praguri
  | 'visual'       // deficiență de vedere: trasee simple, repere
  | 'reduced';     // mobilitate redusă: distanțe scurte, fără scări

// ---------- Graful clădirii ----------
export type NodeType =
  | 'entrance'
  | 'corridor'
  | 'junction'
  | 'elevator'
  | 'stairs'
  | 'ramp'
  | 'desk'
  | 'restroom_accessible'
  | 'waiting_area';

export interface Floor {
  id: string;        // ex. "f0"
  level: number;     // 0 = parter, 1 = etaj 1
  name: string;
  plan: string;      // calea către planul etajului (svg/png)
  width: number;     // dimensiunile planului, în unități ale hărții
  height: number;
}

export interface GraphNode {
  id: string;
  floor: string;     // id-ul etajului
  type: NodeType;
  x: number;
  y: number;
  label?: string;
  deskId?: string;   // doar pentru type = 'desk'
}

export type EdgeMode = 'walk' | 'elevator' | 'stairs' | 'ramp';

export interface Edge {
  from: string;      // id nod
  to: string;        // id nod (muchia e bidirecțională)
  distance: number;  // în metri
  mode: EdgeMode;
  stepFree: boolean; // true = fără scări sau praguri
  minWidth?: number; // lățimea trecerii, în metri
  slope?: number;    // panta în procente, dacă e cazul
  status?: 'ok' | 'out_of_service'; // ex. lift defect
}

export interface Landmark {
  nodeId: string;
  text: string;      // ex. "Panoul de informații pe dreapta"
  tactile?: boolean; // are reper tactil sau sonor
}

export interface Building {
  id: string;
  name: string;
  floors: Floor[];
  nodes: GraphNode[];
  edges: Edge[];
  landmarks: Landmark[];
}

// ---------- Traseul calculat ----------
export type StepAction =
  | 'walk'
  | 'turn'
  | 'elevator'
  | 'stairs'
  | 'ramp'
  | 'arrive';

export interface RouteStep {
  id: number;
  action: StepAction;
  text: string;                    // ce se afișează și ce se citește cu voce tare
  distance?: number;               // metri, pentru 'walk'
  direction?: 'left' | 'right' | 'straight' | 'back'; // pentru 'turn'
  toFloor?: string;                // pentru 'elevator' / 'stairs' / 'ramp'
  landmark?: string;               // reper util, dacă există
  nodeId: string;                  // nodul în care se termină pasul
}

export interface Route {
  from: string;
  to: string;
  profile: AccessibilityProfile;
  steps: RouteStep[];
  nodePath: string[];              // lista de noduri parcurse, pentru desenat pe hartă
  totalDistance: number;           // metri
  estimatedSeconds: number;
}

// ---------- Cozi și tichete ----------
export interface Service {
  id: string;
  name: string;
  avgMinutes: number;
  deskIds: string[];
}

export interface Desk {
  id: string;
  nodeId: string;                  // nodul din graf unde se află ghișeul
  status: 'open' | 'paused' | 'closed';
  currentTicketId?: string;
}

export type TicketStatus =
  | 'waiting'
  | 'called'
  | 'in_service'
  | 'done'
  | 'cancelled'
  | 'no_show';

export interface Ticket {
  id: string;
  serviceId: string;
  number: string;                  // ex. "A-017"
  status: TicketStatus;
  profile: AccessibilityProfile;   // doar profilul de rută, fără date personale
  deskId?: string;                 // setat când tichetul e chemat
  createdAt: string;               // ISO 8601
  calledAt?: string;
  positionInQueue?: number;
  estimatedWaitMinutes?: number;
}
