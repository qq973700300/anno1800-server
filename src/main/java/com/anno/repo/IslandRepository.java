package com.anno.repo;

import java.util.List;

import com.anno.domain.IslandEntity;
import org.springframework.data.jpa.repository.JpaRepository;

public interface IslandRepository extends JpaRepository<IslandEntity, Long> {

    List<IslandEntity> findByOwnerId(Long ownerId);

    int countByOwnerId(Long ownerId);
}
