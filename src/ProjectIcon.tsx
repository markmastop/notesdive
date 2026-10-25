import { Bike, Camera, CarFront, Coffee, Dumbbell, Flag, House, Mountain, Music, Palette, Plane, Wrench, BookOpen, BriefcaseBusiness, Building2, CodeXml, FlaskConical, FolderKanban, GraduationCap, Handshake, Heart, Leaf, Lightbulb, Rocket } from "lucide-react";

export const projectIcons = [
  { value: "folder", label: "Folder", Icon: FolderKanban },
  { value: "briefcase", label: "Work", Icon: BriefcaseBusiness },
  { value: "education", label: "Education", Icon: GraduationCap },
  { value: "book", label: "Reading", Icon: BookOpen },
  { value: "research", label: "Research", Icon: FlaskConical },
  { value: "code", label: "Development", Icon: CodeXml },
  { value: "idea", label: "Ideas", Icon: Lightbulb },
  { value: "building", label: "Organization", Icon: Building2 },
  { value: "heart", label: "Personal", Icon: Heart },
  { value: "partners", label: "Partners", Icon: Handshake },
  { value: "leaf", label: "Nature", Icon: Leaf },
  { value: "rocket", label: "Launch", Icon: Rocket },
  { value: "sports", label: "Sports", Icon: Dumbbell },
  { value: "car", label: "Car", Icon: CarFront },
  { value: "home", label: "Home", Icon: House },
  { value: "cycling", label: "Cycling", Icon: Bike },
  { value: "outdoors", label: "Outdoors", Icon: Mountain },
  { value: "travel", label: "Travel", Icon: Plane },
  { value: "photography", label: "Photography", Icon: Camera },
  { value: "music", label: "Music", Icon: Music },
  { value: "coffee", label: "Coffee", Icon: Coffee },
  { value: "tools", label: "Tools", Icon: Wrench },
  { value: "art", label: "Art", Icon: Palette },
  { value: "goals", label: "Goals", Icon: Flag },
] as const;

export type ProjectIconName = typeof projectIcons[number]["value"];

export function ProjectIcon({ icon, size = 16 }: { icon?: ProjectIconName; size?: number }) {
  const Icon = projectIcons.find((choice) => choice.value === icon)?.Icon ?? FolderKanban;
  return <Icon size={size} aria-hidden="true" />;
}
