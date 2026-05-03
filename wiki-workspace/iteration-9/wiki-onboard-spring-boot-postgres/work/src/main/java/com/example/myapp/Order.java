package com.example.myapp;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Column;

@Entity
@Table(name = "orders")
public class Order {
    @Id
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "amount_cents", nullable = false)
    private Long amountCents;

    public Long getId() { return id; }
    public Long getUserId() { return userId; }
    public Long getAmountCents() { return amountCents; }
}
