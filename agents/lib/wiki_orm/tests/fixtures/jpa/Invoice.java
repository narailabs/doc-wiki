package com.example.model;

import jakarta.persistence.*;

@Entity
@Table(schema = "app", name = "invoice")
public class Invoice {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "amount")
    private Double amount;

    @ManyToOne
    @JoinColumn(name = "user_id")
    private User user;
}
