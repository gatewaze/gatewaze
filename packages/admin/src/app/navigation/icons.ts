import { TbPalette } from "react-icons/tb";
import * as HeroOutline from "@heroicons/react/24/outline";
import { ElementType } from "react";

import DashboardsIcon from "@/assets/dualicons/dashboards.svg?react";
import SettingIcon from "@/assets/dualicons/setting.svg?react";

// Build a lookup from short names (e.g. "Mail", "Globe", "Clock") to Heroicons.
// Strips the "Icon" suffix and maps common Lucide-style aliases used by modules.
const heroIconsByName: Record<string, ElementType> = {};
for (const [exportName, component] of Object.entries(HeroOutline)) {
  if (typeof component !== 'function' && typeof component !== 'object') continue;
  if (!component) continue;
  // e.g. "EnvelopeIcon" → "Envelope"
  const shortName = exportName.replace(/Icon$/, '');
  heroIconsByName[shortName] = component as ElementType;
}

// Common Lucide / shorthand aliases → Heroicon equivalents
const aliases: Record<string, ElementType> = {
  Mail: HeroOutline.EnvelopeIcon,
  MessageSquare: HeroOutline.ChatBubbleLeftRightIcon,
  Gift: HeroOutline.GiftIcon,
  Calendar: HeroOutline.CalendarIcon,
  Filter: HeroOutline.FunnelIcon,
  ArrowRightLeft: HeroOutline.ArrowsRightLeftIcon,
  CreditCard: HeroOutline.CreditCardIcon,
  FileText: HeroOutline.DocumentTextIcon,
  Clock: HeroOutline.ClockIcon,
  ClipboardList: HeroOutline.ClipboardDocumentListIcon,
  Building: HeroOutline.BuildingOfficeIcon,
  Puzzle: HeroOutline.PuzzlePieceIcon,
  Tag: HeroOutline.TagIcon,
  Globe: HeroOutline.GlobeAltIcon,
  Newspaper: HeroOutline.NewspaperIcon,
  Shield: HeroOutline.ShieldCheckIcon,
  Users: HeroOutline.UsersIcon,
  Hash: HeroOutline.HashtagIcon,
  DollarSign: HeroOutline.CurrencyDollarIcon,
  Trophy: HeroOutline.TrophyIcon,
};

export const navigationIcons: Record<string, ElementType> = {
  // All Heroicons by short name (e.g. "Envelope", "GlobeAlt", "ChatBubbleLeftRight")
  ...heroIconsByName,
  // Lucide-style aliases used by modules
  ...aliases,
  // Custom SVG icons
  dashboards: DashboardsIcon,
  settings: SettingIcon,
  // Explicit overrides for sidebar groups/items
  admin: HeroOutline.Cog6ToothIcon,
  blog: HeroOutline.PencilSquareIcon,
  "dashboards.home": HeroOutline.HomeIcon,
  "dashboards.competitions": HeroOutline.TrophyIcon,
  "dashboards.discounts": HeroOutline.TicketIcon,
  "dashboards.offers": HeroOutline.GiftIcon,
  "dashboards.members": HeroOutline.UserGroupIcon,
  "dashboards.segments": HeroOutline.FunnelIcon,
  "dashboards.calendars": HeroOutline.CalendarDaysIcon,
  "dashboards.events": HeroOutline.CalendarIcon,
  "dashboards.jobs": HeroOutline.BriefcaseIcon,
  "dashboards.cohorts": HeroOutline.AcademicCapIcon,
  "dashboards.surveys": HeroOutline.ClipboardDocumentListIcon,
  "dashboards.newsletters": HeroOutline.NewspaperIcon,
  "dashboards.slack": HeroOutline.ChatBubbleLeftRightIcon,
  "settings.general": HeroOutline.UserIcon,
  "settings.appearance": TbPalette,
  "settings.branding": HeroOutline.SwatchIcon,
  "admin.users": HeroOutline.UsersIcon,
  "admin.accounts": HeroOutline.BuildingOfficeIcon,
  "admin.events": HeroOutline.CalendarIcon,
  "admin.scrapers": HeroOutline.CommandLineIcon,
  "admin.emails": HeroOutline.EnvelopeIcon,
  "admin.payments": HeroOutline.CreditCardIcon,
  "admin.topics": HeroOutline.TagIcon,
  "admin.compliance": HeroOutline.ShieldCheckIcon,
  "admin.integrations": HeroOutline.ArrowsRightLeftIcon,
  "admin.scheduler": HeroOutline.QueueListIcon,
  "document-text": HeroOutline.DocumentTextIcon,
  "tag": HeroOutline.TagIcon,
  "logout": HeroOutline.ArrowLeftStartOnRectangleIcon,
};
