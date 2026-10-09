package com.anno.repo;

import java.util.Optional;

import com.anno.domain.Good;
import com.anno.domain.MarketPriceEntity;
import org.springframework.data.jpa.repository.JpaRepository;

public interface MarketPriceRepository extends JpaRepository<MarketPriceEntity, Long> {

    Optional<MarketPriceEntity> findByGood(Good good);
}
