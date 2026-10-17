"use client";

import { useEffect, useState } from "react";
import { Users, Store, TrendingUp, Zap, LayoutGrid, Sparkles, MessageSquare, BellRing } from "lucide-react";
import AdminVendeurs from "./AdminVendeurs";
import AdminAnnonces from "./AdminAnnonces";
import AdminAvis from "./AdminAvis";
import AdminNotifications from "./AdminNotifications";

type Stats = {
  chiffreAffaires: number;
  nombreVendeurs: number;
  nombreAnnonces: number;
  annoncesVisibles: number;
  annoncesBoostees: number;
  nombreClients: number;
  abonnementsActifs: number;
  abonnementsEnAttente: number;
};

const formatFCFA = (n: number) =>
  new Intl.NumberFormat("fr-FR").format(n) + " F";

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [onglet, setOnglet] = useState<"apercu" | "vendeurs" | "annonces" | "avis" | "notifications">("apercu");

  async function chargerStats() {
    const res = await fetch("/api/admin/stats");
    if (res.ok) setStats(await res.json());
  }

  useEffect(() => {
    chargerStats();
  }, []);

  return (
    <div className="space-y-8">
      {/* Onglets */}
      <div className="flex flex-wrap gap-2">
        <OngletBtn actif={onglet === "apercu"} onClick={() => setOnglet("apercu")} icon={<LayoutGrid size={15} />}>
          Vue d&apos;ensemble
        </OngletBtn>
        <OngletBtn actif={onglet === "vendeurs"} onClick={() => setOnglet("vendeurs")} icon={<Store size={15} />}>
          Vendeurs
        </OngletBtn>
        <OngletBtn actif={onglet === "annonces"} onClick={() => setOnglet("annonces")} icon={<Sparkles size={15} />}>
          Annonces
        </OngletBtn>
        <OngletBtn actif={onglet === "avis"} onClick={() => setOnglet("avis")} icon={<MessageSquare size={15} />}>
          Avis
        </OngletBtn>
        <OngletBtn actif={onglet === "notifications"} onClick={() => setOnglet("notifications")} icon={<BellRing size={15} />}>
          Notifications
        </OngletBtn>
      </div>

      {onglet === "apercu" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
            <StatCard
              icon={<TrendingUp size={18} />}
              label="Chiffre d&apos;affaires"
              value={stats ? formatFCFA(stats.chiffreAffaires) : "…"}
              accent="from-neon-500 to-neonpink-500"
              grande
            />
            <StatCard
              icon={<Store size={18} />}
              label="Vendeurs"
              value={stats ? String(stats.nombreVendeurs) : "…"}
              accent="from-neon-600 to-neon-400"
            />
            <StatCard
              icon={<Sparkles size={18} />}
              label="Annonces"
              value={stats ? String(stats.nombreAnnonces) : "…"}
              accent="from-neonpink-500 to-neon-500"
            />
            <StatCard
              icon={<Users size={18} />}
              label="Clients"
              value={stats ? String(stats.nombreClients) : "…"}
              accent="from-neon-400 to-neonpink-400"
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
            <MiniStat label="Annonces visibles" value={stats?.annoncesVisibles} />
            <MiniStat label="Annonces boostées" value={stats?.annoncesBoostees} icon={<Zap size={12} className="text-neonpink-400" />} />
            <MiniStat label="Abonnements actifs" value={stats?.abonnementsActifs} />
            <MiniStat label="En attente de validation" value={stats?.abonnementsEnAttente} alerte={!!stats?.abonnementsEnAttente} />
          </div>
        </div>
      )}

      {onglet === "vendeurs" && <AdminVendeurs onChangement={chargerStats} />}
      {onglet === "annonces" && <AdminAnnonces onChangement={chargerStats} />}
      {onglet === "avis" && <AdminAvis />}
      {onglet === "notifications" && <AdminNotifications />}
    </div>
  );
}

function OngletBtn({
  actif,
  onClick,
  icon,
  children,
}: {
  actif: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all ${
        actif
          ? "btn-neon"
          : "bg-white/5 text-neon-300/80 border border-white/10 hover:border-neon-500/50 hover:text-white"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function StatCard({
  icon,
  label,
  value,
  accent,
  grande,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: string;
  grande?: boolean;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl bg-white/5 neon-border p-4 md:p-5 ${
        grande ? "col-span-2" : ""
      }`}
    >
      <div className={`absolute -top-6 -right-6 w-24 h-24 rounded-full bg-gradient-to-br ${accent} opacity-20 blur-2xl`} />
      <div className={`inline-flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br ${accent} text-white mb-3 shadow-lg`}>
        {icon}
      </div>
      <p className="text-xs uppercase tracking-wide text-neon-300/60 mb-1">{label}</p>
      <p className={`font-display font-semibold text-white ${grande ? "text-3xl neon-text" : "text-xl"}`}>{value}</p>
    </div>
  );
}

function MiniStat({
  label,
  value,
  icon,
  alerte,
}: {
  label: string;
  value?: number;
  icon?: React.ReactNode;
  alerte?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-3 py-2.5 ${
        alerte ? "border-mango-500/50 bg-mango-500/10" : "border-white/10 bg-white/[0.03]"
      }`}
    >
      <p className="text-[11px] text-neon-300/60 flex items-center gap-1">
        {icon}
        {label}
      </p>
      <p className="font-semibold text-white text-lg">{value ?? "…"}</p>
    </div>
  );
}
