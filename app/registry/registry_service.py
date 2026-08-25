"""
Strategy Registry & Qualification Certificate Service (Modul 6).
Maintains active strategy identity records, handles status transitions, and automatically awards badge certificates.
"""

from datetime import datetime, timezone
import json
import logging
from pathlib import Path
import threading
from typing import Any, Dict, List, Optional
import uuid

from app.registry.career_log import career_logger
from app.registry.identity import (
    BadgeCertificate,
    BadgeType,
    CareerEventType,
    LifecycleStatus,
    StrategyIdentity,
)

logger = logging.getLogger("strategy_registry")


class StrategyRegistry:
    """
    Central strategy registry managing identities, genome lineage hashes, certificates and lifecycle stages.
    """

    def __init__(self, base_dir: str = "data/registry"):
        """
        Initializes StrategyRegistry with file-backed persistence.

        Args:
            base_dir: Path where strategies manifest and logs are saved.
        """
        self.base_dir = Path(base_dir)
        self.registry_file = self.base_dir / "strategies.json"
        self._lock = threading.Lock()
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self._ensure_manifest()

    def _ensure_manifest(self) -> None:
        """Initializes empty strategy manifest if it does not already exist."""
        if not self.registry_file.exists():
            with open(self.registry_file, "w", encoding="utf-8") as f:
                json.dump({}, f, indent=2)

    def _load_manifest(self) -> Dict[str, Dict[str, Any]]:
        """Reads strategy registry manifest from disk."""
        try:
            with open(self.registry_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Failed to read strategies manifest: {e}")
            return {}

    def _save_manifest(self, data: Dict[str, Dict[str, Any]]) -> None:
        """Writes strategy registry manifest to disk atomically."""
        temp_file = self.registry_file.with_suffix(".tmp")
        with open(temp_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        temp_file.replace(self.registry_file)

    def register_strategy(
        self,
        name: str,
        parameters: Dict[str, Any],
        genome: Optional[Dict[str, Any]] = None,
        generation: int = 1,
        parent_ids: Optional[List[str]] = None,
        asset_pair: str = "BTC/USD",
        timeframe: str = "15m",
        code_snippet: Optional[str] = None,
        initial_status: LifecycleStatus = LifecycleStatus.ACADEMY,
        strategy_id: Optional[str] = None
    ) -> StrategyIdentity:
        """
        Registers a new strategy in the registry with computed DNA origin hash and initiates career log.

        Args:
            name: Strategy name.
            parameters: Indicator and execution parameters.
            genome: Optional genetic chromosome genes.
            generation: Generation number from genetic walk-forward or manual creation.
            parent_ids: Parent strategy UUIDs if bred.
            asset_pair: Target trading symbol pair.
            timeframe: Primary operational timeframe.
            code_snippet: Executable strategy script.
            initial_status: Starting lifecycle status.
            strategy_id: Optional fixed UUID.

        Returns:
            Newly registered StrategyIdentity instance.
        """
        with self._lock:
            manifest = self._load_manifest()
            
            dna_hash = StrategyIdentity.generate_dna_hash(parameters, genome)
            strat_id = strategy_id or str(uuid.uuid4())
            now_iso = datetime.now(timezone.utc).isoformat()

            identity = StrategyIdentity(
                id=strat_id,
                name=name,
                born_from_hash=dna_hash,
                generation=generation,
                parent_ids=parent_ids or [],
                asset_pair=asset_pair,
                timeframe=timeframe,
                status=initial_status,
                created_at=now_iso,
                updated_at=now_iso,
                parameters=parameters,
                genome=genome,
                code_snippet=code_snippet,
                badges=[],
                metrics={},
                drills_passed=[],
                shadow_race_record={"wins": 0, "losses": 0, "draws": 0}
            )

            manifest[strat_id] = identity.model_dump()
            self._save_manifest(manifest)

            # Log Career Event: BORN
            career_logger.append_event(
                strategy_id=strat_id,
                event_type=CareerEventType.BORN,
                title="Strategy Inception (BORN)",
                description=f"Strategy '{name}' registered in Academy. Generation {generation}, DNA Hash {dna_hash[:16]}...",
                payload={
                    "name": name,
                    "born_from_hash": dna_hash,
                    "generation": generation,
                    "asset_pair": asset_pair,
                    "parameters_count": len(parameters),
                    "has_genome": genome is not None
                },
                actor="STRATEGY_REGISTRY"
            )

            return identity

    def get_strategy(self, strategy_id: str) -> Optional[StrategyIdentity]:
        """
        Retrieves a StrategyIdentity by ID.

        Args:
            strategy_id: Unique strategy identifier.

        Returns:
            StrategyIdentity if found, None otherwise.
        """
        with self._lock:
            manifest = self._load_manifest()
            if strategy_id in manifest:
                return StrategyIdentity.model_validate(manifest[strategy_id])
            return None

    def list_strategies(
        self,
        status: Optional[LifecycleStatus] = None,
        asset_pair: Optional[str] = None,
        limit: int = 100
    ) -> List[StrategyIdentity]:
        """
        Lists all registered strategies with optional filters.

        Args:
            status: Optional filter by lifecycle status.
            asset_pair: Optional filter by symbol pair.
            limit: Maximum items to return.

        Returns:
            List of StrategyIdentity objects.
        """
        with self._lock:
            manifest = self._load_manifest()
            results: List[StrategyIdentity] = []
            for data in manifest.values():
                strat = StrategyIdentity.model_validate(data)
                if status and strat.status != status:
                    continue
                if asset_pair and strat.asset_pair != asset_pair:
                    continue
                results.append(strat)

            # Sort by created_at descending
            results.sort(key=lambda s: s.created_at, reverse=True)
            return results[:limit]

    def update_status(
        self,
        strategy_id: str,
        new_status: LifecycleStatus,
        reason: str,
        payload: Optional[Dict[str, Any]] = None,
        actor: str = "SYSTEM_ORCHESTRATOR"
    ) -> Optional[StrategyIdentity]:
        """
        Updates the lifecycle status of a strategy and appends an immutable event to the career log.

        Args:
            strategy_id: Strategy identifier.
            new_status: Target lifecycle status.
            reason: Contextual justification for status change.
            payload: Relevant execution metrics or validation logs.
            actor: Calling component or agent.

        Returns:
            Updated StrategyIdentity or None if strategy not found.
        """
        with self._lock:
            manifest = self._load_manifest()
            if strategy_id not in manifest:
                return None

            strat_data = manifest[strategy_id]
            old_status = strat_data.get("status")
            strat_data["status"] = new_status.value
            strat_data["updated_at"] = datetime.now(timezone.utc).isoformat()
            
            manifest[strategy_id] = strat_data
            self._save_manifest(manifest)

            # Map lifecycle transition to appropriate CareerEventType
            event_type = CareerEventType.METRICS_SNAPSHOT
            if new_status == LifecycleStatus.LIVE_CHAMPION:
                event_type = CareerEventType.PROMOTED_TO_LIVE
            elif new_status == LifecycleStatus.SHADOW_CHALLENGER:
                event_type = CareerEventType.ENTERED_SHADOW_QUEUE
            elif new_status == LifecycleStatus.DEGRADED:
                event_type = CareerEventType.DEGRADED_TO_ACADEMY
            elif new_status == LifecycleStatus.RETIRED:
                event_type = CareerEventType.RETIRED

            career_logger.append_event(
                strategy_id=strategy_id,
                event_type=event_type,
                title=f"Status Transition: {old_status} -> {new_status.value}",
                description=reason,
                payload={"old_status": old_status, "new_status": new_status.value, **(payload or {})},
                actor=actor
            )

            return StrategyIdentity.model_validate(strat_data)

    def award_badge(
        self,
        strategy_id: str,
        badge_type: BadgeType,
        evidence: Dict[str, Any],
        title: Optional[str] = None,
        description: Optional[str] = None,
        actor: str = "QUALIFICATION_COMMITTEE"
    ) -> Optional[BadgeCertificate]:
        """
        Awards a verified qualification badge to a strategy, preventing duplicates.

        Args:
            strategy_id: Strategy identifier.
            badge_type: Type of badge to award.
            evidence: Dictionary containing quantitative proof metrics.
            title: Optional custom title.
            description: Optional custom description.
            actor: Awarding body.

        Returns:
            Created BadgeCertificate or existing if already earned.
        """
        badge_metadata = {
            BadgeType.BEAR_MARKET_SURVIVOR: (
                "Bear Market Survivor",
                "Successfully generated positive returns during simulated catastrophic market drawdowns without breach of risk boundaries."
            ),
            BadgeType.DSR_ELITE: (
                "DSR Elite (Deflated Sharpe > 0.95)",
                "Statistically confirmed immunity to selection bias and p-hacking under Bailey & Lopez de Prado Deflated Sharpe testing."
            ),
            BadgeType.FLASH_CRASH_TESTED: (
                "Flash Crash Stress Certified",
                "Maintained capital preservation through hyper-volatility flash crash stress drill (>20% instantaneous price collapse)."
            ),
            BadgeType.MEAN_REVERSION_MASTER: (
                "Mean Reversion Master (Hurst < 0.40)",
                "Superior trade profitability in high-entropy chop and oscillating mean-reverting market regimes."
            ),
            BadgeType.TREND_SNIPER: (
                "Trend Sniper (Hurst > 0.65)",
                "High precision trend-following capture in persistent directional market momentum phases."
            ),
            BadgeType.WFO_CHAMPION: (
                "Walk-Forward Optimization Champion",
                "Achieved robust out-of-sample Sharpe > 1.5 across consecutive walk-forward test segments."
            ),
            BadgeType.SHADOW_RACER: (
                "Shadow Queue Racing Victor",
                "Outperformed reigning live benchmark strategy in head-to-head live shadow A/B race."
            ),
            BadgeType.LIVE_PROMOTED: (
                "Promoted to Level 4 Live Execution",
                "Completed all mandatory graduation gates and attained full production trading authority."
            ),
            BadgeType.BATTLE_TESTED_VETERAN: (
                "Battle-Tested Veteran (50+ Live Trades)",
                "Maintained verified positive Sharpe and low drawdown over extended production operational horizon."
            ),
        }

        default_title, default_desc = badge_metadata.get(badge_type, (badge_type.value, "Quantitative achievement."))
        final_title = title or default_title
        final_desc = description or default_desc

        with self._lock:
            manifest = self._load_manifest()
            if strategy_id not in manifest:
                return None

            strat_data = manifest[strategy_id]
            existing_badges = strat_data.get("badges", [])

            # Check for existing badge of this type
            for b in existing_badges:
                if b.get("badge_type") == badge_type.value:
                    return BadgeCertificate.model_validate(b)

            cert = BadgeCertificate(
                badge_type=badge_type,
                title=final_title,
                description=final_desc,
                evidence=evidence,
                issuer="QUANT_REGISTRY_CERTIFICATE_AUTHORITY"
            )

            existing_badges.append(cert.model_dump())
            strat_data["badges"] = existing_badges
            strat_data["updated_at"] = datetime.now(timezone.utc).isoformat()
            
            manifest[strategy_id] = strat_data
            self._save_manifest(manifest)

            # Log Badge Award Event in Career Log
            career_logger.append_event(
                strategy_id=strategy_id,
                event_type=CareerEventType.BADGE_AWARDED,
                title=f"Badge Earned: {final_title}",
                description=f"Earned certificate '{final_title}' with evidence: {json.dumps(evidence)}",
                payload={"badge_type": badge_type.value, "evidence": evidence},
                actor=actor
            )

            return cert

    def check_and_award_milestone_badges(self, strategy_id: str, metrics: Dict[str, Any]) -> List[BadgeCertificate]:
        """
        Evaluates current metrics against registry badge milestone rules and auto-awards earned certificates.

        Args:
            strategy_id: Target strategy ID.
            metrics: Performance metrics dictionary (dsr, sharpe, pnl, max_drawdown, win_rate, total_trades, etc.).

        Returns:
            List of newly awarded BadgeCertificates.
        """
        awarded: List[BadgeCertificate] = []
        
        # 1. DSR Elite (> 0.95)
        dsr_val = float(metrics.get("dsr") or metrics.get("deflatedSharpeRatio") or 0.0)
        if dsr_val >= 0.95:
            cert = self.award_badge(
                strategy_id=strategy_id,
                badge_type=BadgeType.DSR_ELITE,
                evidence={"dsr": dsr_val, "threshold": 0.95}
            )
            if cert:
                awarded.append(cert)

        # 2. WFO Champion (Sharpe >= 1.5, Profit Factor >= 1.8)
        sharpe = float(metrics.get("sharpeRatio") or metrics.get("sharpe") or 0.0)
        profit_factor = float(metrics.get("profitFactor") or 0.0)
        if sharpe >= 1.5 and profit_factor >= 1.8:
            cert = self.award_badge(
                strategy_id=strategy_id,
                badge_type=BadgeType.WFO_CHAMPION,
                evidence={"sharpe": sharpe, "profitFactor": profit_factor}
            )
            if cert:
                awarded.append(cert)

        # 3. Battle-Tested Veteran (> 50 trades, Sharpe > 1.25)
        trades_count = int(metrics.get("totalTrades") or metrics.get("trades_count") or 0)
        if trades_count >= 50 and sharpe >= 1.25:
            cert = self.award_badge(
                strategy_id=strategy_id,
                badge_type=BadgeType.BATTLE_TESTED_VETERAN,
                evidence={"totalTrades": trades_count, "sharpe": sharpe}
            )
            if cert:
                awarded.append(cert)

        return awarded

    def get_career_book(self, strategy_id: str) -> Dict[str, Any]:
        """
        Assembles complete 'Karteibuch' (Career Book) including identity, badges, career timeline and integrity check.

        Args:
            strategy_id: Unique strategy identifier.

        Returns:
            Dictionary containing identity, verified timeline, badges and telemetry stats.
        """
        identity = self.get_strategy(strategy_id)
        if not identity:
            return {"error": f"Strategy {strategy_id} not found."}

        timeline = career_logger.get_events(strategy_id)
        is_intact, integrity_msg = career_logger.verify_log_integrity(strategy_id)

        return {
            "identity": identity.model_dump(),
            "badges_count": len(identity.badges),
            "badges": [b.model_dump() for b in identity.badges],
            "timeline": [ev.model_dump() for ev in timeline],
            "timeline_length": len(timeline),
            "cryptographic_integrity": {
                "verified": is_intact,
                "message": integrity_msg
            }
        }


# Global Singleton
strategy_registry = StrategyRegistry()
